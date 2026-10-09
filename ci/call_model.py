#!/usr/bin/env python3
"""Call the configured provider for the evaluator contract."""

from __future__ import annotations

import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(__file__).with_name("model_providers.json")
MAX_INPUT_CHARS = 4_000_000
MAX_RESPONSE_BYTES = 1_000_000
REQUEST_TIMEOUT_SECONDS = 180
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
RETRY_DELAY_SECONDS = 2
RETRY_DELAY_JITTER_SECONDS = 2
MAX_RETRY_DELAY_SECONDS = 30
ALLOWED_PROTOCOLS = {"ollama", "openai-compatible", "anthropic", "google"}
ALLOWED_ENDPOINTS = {
    "https://ollama.com/api",
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "https://generativelanguage.googleapis.com/v1beta",
}
ENDPOINTS_BY_PROTOCOL = {
    "ollama": "https://ollama.com/api",
    "openai-compatible": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "google": "https://generativelanguage.googleapis.com/v1beta",
}


class ProviderError(RuntimeError):
    """Report a provider failure without exposing request or response data."""


def _read_text_from_env(name: str) -> str:
    path_text = os.environ.get(name)
    if not path_text:
        raise ProviderError(f"missing {name}")
    path = Path(path_text)
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ProviderError(f"cannot read {name}") from error


def _load_config() -> dict[str, Any]:
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ProviderError("provider configuration is unreadable") from error
    if not isinstance(config, dict):
        raise ProviderError("provider configuration is not an object")
    return config


def _validate_endpoint(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise ProviderError("provider endpoint must use HTTPS without credentials")
    if parsed.query or parsed.fragment or not parsed.netloc:
        raise ProviderError("provider endpoint contains unsupported URL fields")
    normalized = endpoint.rstrip("/")
    if normalized not in ALLOWED_ENDPOINTS:
        raise ProviderError("provider endpoint is not allowlisted")
    return normalized


def _load_profile() -> dict[str, Any]:
    config = _load_config()
    provider_name = config.get("active_provider")
    providers = config.get("providers")
    if not isinstance(provider_name, str) or not isinstance(providers, dict):
        raise ProviderError("provider configuration has an invalid registry")
    profile = providers.get(provider_name)
    if not isinstance(profile, dict):
        raise ProviderError("active provider is not configured")
    protocol = profile.get("protocol")
    endpoint = profile.get("endpoint")
    model = profile.get("model")
    if protocol not in ALLOWED_PROTOCOLS:
        raise ProviderError("provider protocol is not allowlisted")
    if not isinstance(endpoint, str) or not isinstance(model, str) or not model:
        raise ProviderError("provider profile is incomplete")
    if len(model) > 200 or any(ord(character) < 32 for character in model):
        raise ProviderError("provider model is invalid")
    profile = dict(profile)
    normalized_endpoint = _validate_endpoint(endpoint)
    if normalized_endpoint != ENDPOINTS_BY_PROTOCOL[protocol]:
        raise ProviderError("provider endpoint does not match its protocol")
    profile["endpoint"] = normalized_endpoint
    profile["name"] = provider_name
    return profile


def _headers(protocol: str, api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if protocol in {"ollama", "openai-compatible"}:
        headers["Authorization"] = f"Bearer {api_key}"
    elif protocol == "anthropic":
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
    else:
        headers["x-goog-api-key"] = api_key
    return headers


def _message_payload(system_prompt: str, case_text: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": case_text},
    ]


def _build_request(profile: dict[str, Any], system_prompt: str,
                   case_text: str, api_key: str) -> Request:
    protocol = profile["protocol"]
    model = profile["model"]
    max_tokens = profile.get("max_output_tokens", 8192)
    messages = _message_payload(system_prompt, case_text)
    if protocol == "ollama":
        url = f"{profile['endpoint']}/chat"
        body = {
            "model": model,
            "messages": messages,
            "stream": False,
            "think": False,
            "options": {"temperature": 0, "num_predict": max_tokens},
        }
    elif protocol == "openai-compatible":
        url = f"{profile['endpoint']}/chat/completions"
        body = {
            "model": model,
            "messages": messages,
            "stream": False,
            "temperature": 0,
            "max_tokens": max_tokens,
        }
    elif protocol == "anthropic":
        url = f"{profile['endpoint']}/messages"
        body = {
            "model": model,
            "system": system_prompt,
            "messages": [{"role": "user", "content": case_text}],
            "max_tokens": max_tokens,
            "temperature": 0,
        }
    else:
        encoded_model = quote(model, safe="")
        url = f"{profile['endpoint']}/models/{encoded_model}:generateContent"
        body = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": case_text}]}],
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": max_tokens,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }
    serialized = json.dumps(body, ensure_ascii=True, separators=(",", ":"))
    return Request(
        url,
        data=serialized.encode("utf-8"),
        headers=_headers(protocol, api_key),
        method="POST",
    )


def _read_response(response: Any) -> dict[str, Any]:
    content_length = response.headers.get("Content-Length")
    if content_length:
        try:
            declared_length = int(content_length)
        except (TypeError, ValueError) as error:
            raise ProviderError("provider response has an invalid length") from error
        if declared_length < 0 or declared_length > MAX_RESPONSE_BYTES:
            raise ProviderError("provider response exceeds the configured limit")
    raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ProviderError("provider response exceeds the configured limit")
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ProviderError("provider response is not valid JSON") from error
    if not isinstance(result, dict):
        raise ProviderError("provider response is not an object")
    return result


def _extract_text(protocol: str, result: dict[str, Any]) -> str:
    if protocol == "ollama":
        message = result.get("message")
        text = message.get("content") if isinstance(message, dict) else None
    elif protocol == "openai-compatible":
        choices = result.get("choices")
        first = choices[0] if isinstance(choices, list) and choices else None
        message = first.get("message") if isinstance(first, dict) else None
        text = message.get("content") if isinstance(message, dict) else None
    elif protocol == "anthropic":
        blocks = result.get("content")
        first = blocks[0] if isinstance(blocks, list) and blocks else None
        text = first.get("text") if isinstance(first, dict) else None
    else:
        candidates = result.get("candidates")
        first = candidates[0] if isinstance(candidates, list) and candidates else None
        content = first.get("content") if isinstance(first, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            parts = []
        text_parts = [
            part["text"]
            for part in parts
            if isinstance(part, dict)
            and not part.get("thought")
            and isinstance(part.get("text"), str)
        ]
        text = "".join(text_parts) if text_parts else None
    if not isinstance(text, str) or not text.strip():
        raise ProviderError("provider response has no text content")
    return text


def _retry_delay_seconds(retry_after: str | None) -> float:
    """Return a bounded delay before the single retry.

    Honors a provider Retry-After header when present. Retry-After can also
    carry an HTTP date; float() rejects that form and falls back to the
    jittered default rather than parsing a date string.
    """
    if retry_after is not None:
        try:
            parsed = float(retry_after)
        except ValueError:
            parsed = None
        if parsed is not None and parsed >= 0:
            return min(parsed, MAX_RETRY_DELAY_SECONDS)
    return min(
        RETRY_DELAY_SECONDS + random.uniform(0, RETRY_DELAY_JITTER_SECONDS),
        MAX_RETRY_DELAY_SECONDS,
    )


def _request_once(request: Request) -> tuple[dict[str, Any], int | None, str | None]:
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return _read_response(response), None, None
    except HTTPError as error:
        if error.code in RETRYABLE_STATUS_CODES:
            retry_after = error.headers.get("Retry-After") if error.headers else None
            return {}, error.code, retry_after
        raise ProviderError(f"provider request failed with HTTP {error.code}") from error
    except URLError as error:
        raise ProviderError("provider network request failed") from error
    except (OSError, ValueError) as error:
        raise ProviderError("provider response could not be read") from error


def call_model(system_prompt: str, mode: str, case_text: str) -> str:
    """Return the configured provider response for one evaluator request."""
    del mode
    if len(system_prompt) + len(case_text) > MAX_INPUT_CHARS:
        raise ProviderError("review input exceeds the configured limit")
    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise ProviderError("MODEL_API_KEY is not configured")
    profile = _load_profile()
    request = _build_request(profile, system_prompt, case_text, api_key)
    for attempt in range(2):
        result, retry_status, retry_after = _request_once(request)
        if retry_status is None:
            return _extract_text(profile["protocol"], result)
        if attempt == 0:
            time.sleep(_retry_delay_seconds(retry_after))
    raise ProviderError("provider request failed after one retry")


def _clean_finding(raw_finding: Any) -> dict[str, Any] | None:
    """Validate and normalize one finding dictionary."""
    if not isinstance(raw_finding, dict):
        return None
    f = dict(raw_finding)
    sev = str(f.get("severity", "MEDIUM")).upper()
    if sev not in {"CRITICAL", "HIGH", "MEDIUM", "LOW"}:
        sev = "MEDIUM"

    cls_str = str(f.get("class", "2.13"))
    m_cls = re.search(r"2\.\d+", cls_str)
    class_name = m_cls.group(0) if m_cls else "2.13"

    file_name = str(f.get("file", "unknown")) or "unknown"

    try:
        line_num = int(f.get("line", 1))
        if line_num < 1:
            line_num = 1
    except (ValueError, TypeError):
        line_num = 1

    title = str(f.get("title", "Finding")) or "Finding"

    return {
        "severity": sev,
        "class": class_name,
        "file": file_name,
        "line": line_num,
        "title": title,
    }


def _clean_verdict_json(line: str, verdict: str) -> tuple[str, str]:
    """Normalize the VERDICT_JSON payload and return line plus actual verdict."""
    payload_str = line.strip()[len("VERDICT_JSON:"):].strip()
    try:
        data = json.loads(payload_str)
    except (json.JSONDecodeError, UnicodeError):
        return line, verdict

    if not isinstance(data, dict):
        return line, verdict

    raw_findings = data.get("findings")
    findings = []
    if isinstance(raw_findings, list):
        for raw in raw_findings:
            cleaned = _clean_finding(raw)
            if cleaned is not None:
                findings.append(cleaned)

    actual_verdict = verdict
    if actual_verdict == "APPROVE" and any(
        f["severity"] in {"HIGH", "CRITICAL"} for f in findings
    ):
        actual_verdict = "BLOCK"

    clean_payload = {
        "mode": "PR",
        "verdict": actual_verdict,
        "findings": findings,
    }
    normalized_line = "VERDICT_JSON: " + json.dumps(
        clean_payload, ensure_ascii=True, sort_keys=True
    )
    return normalized_line, actual_verdict


def normalize_review_response(response: str) -> str:
    """Normalize model output to conform to the reviewer format contract."""
    if not isinstance(response, str) or not response.strip():
        return response

    lines = response.split("\n")
    verdict: str | None = None
    verdict_index = -1
    justification = ""

    for i, line in enumerate(lines):
        candidate = re.sub(r"^[#\s*_-]+", "", line.strip())
        candidate = re.sub(r"[*_]+", "", candidate).strip()
        match = re.match(
            r"^VERDICT:\s*(APPROVE|BLOCK|NEEDS-HUMAN)(?:\s*[-—:\.]\s*(.*))?$",
            candidate,
            re.IGNORECASE,
        )
        if match:
            verdict = match.group(1).upper()
            justification = (match.group(2) or "").strip()
            verdict_index = i

    if verdict is None:
        return response

    out_lines: list[str] = []
    actual_verdict = verdict
    for i, line in enumerate(lines):
        if i == verdict_index:
            verdict_line = (
                f"VERDICT: {actual_verdict} - {justification}"
                if justification
                else f"VERDICT: {actual_verdict}"
            )
            out_lines.append(verdict_line)
            continue

        if line.strip().startswith("VERDICT_JSON:"):
            json_line, actual_verdict = _clean_verdict_json(line, actual_verdict)
            if (
                verdict == "APPROVE"
                and actual_verdict == "BLOCK"
                and out_lines
                and out_lines[-1].startswith("VERDICT: APPROVE")
            ):
                out_lines[-1] = out_lines[-1].replace(
                    "VERDICT: APPROVE", "VERDICT: BLOCK", 1
                )
            out_lines.append(json_line)
            continue

        out_lines.append(line)

    return "\n".join(out_lines)


def main() -> int:
    """Run the adapter command used by the workflow."""
    try:
        response = call_model(
            _read_text_from_env("AUDIT_PROMPT_FILE"),
            "PR",
            _read_text_from_env("CASE_TEXT_FILE"),
        )
        response = normalize_review_response(response)
    except ProviderError as error:
        print(f"model call failed: {error}", file=sys.stderr)
        return 1
    print(response, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
