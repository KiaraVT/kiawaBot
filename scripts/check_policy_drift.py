#!/usr/bin/env python3
"""Verify that local policy documentation matches pinned upstream specifications."""

from __future__ import annotations

import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_EULER_REF = "main"
DEFAULT_FOUCAULT_REF = "main"

REF_PATTERN = re.compile(r"^[0-9a-zA-Z._\-/]{1,100}$")


def validate_policy_ref(ref: str, name: str) -> str:
    """Validate that the policy git ref is safe."""
    if not REF_PATTERN.match(ref) or ".." in ref:
        raise ValueError(f"Invalid {name} ref: {ref}")
    return ref


def validate_policy_url(url: str, name: str) -> str:
    """Validate that policy URL points to an approved HTTPS GitHub location."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Invalid scheme for {name} URL: {url} (must use https)")
    if parsed.netloc != "raw.githubusercontent.com":
        raise ValueError(f"Invalid host for {name} URL: {url} (must be raw.githubusercontent.com)")
    if not re.fullmatch(r"/abuzucom/[^/]+/.+", parsed.path):
        raise ValueError(f"Invalid path for {name} URL: {url} (must target abuzucom repo)")
    return url


EULER_REF = validate_policy_ref(
    os.getenv("EULER_POLICY_REF", os.getenv("EULER_POLICY_PIN", DEFAULT_EULER_REF)),
    "Euler",
)
FOUCAULT_REF = validate_policy_ref(
    os.getenv("FOUCAULT_POLICY_REF", os.getenv("FOUCAULT_POLICY_PIN", DEFAULT_FOUCAULT_REF)),
    "Foucault",
)

DEFAULT_EULER_URL = f"https://raw.githubusercontent.com/abuzucom/euler/{EULER_REF}/QUALITY.md"
DEFAULT_FOUCAULT_URL = f"https://raw.githubusercontent.com/abuzucom/foucault/{FOUCAULT_REF}/AUDIT.md"

EULER_URL = validate_policy_url(os.getenv("EULER_POLICY_URL", DEFAULT_EULER_URL), "Euler")
FOUCAULT_URL = validate_policy_url(os.getenv("FOUCAULT_POLICY_URL", DEFAULT_FOUCAULT_URL), "Foucault")

def parse_int_env(name: str, default: int, min_val: int, max_val: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        val = int(raw)
        if val < min_val or val > max_val:
            raise ValueError(f"{name} must be between {min_val} and {max_val}, got {val}")
        return val
    except ValueError as e:
        raise ValueError(f"Invalid {name}: {e}") from e


def parse_float_env(name: str, default: float, min_val: float, max_val: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        val = float(raw)
        if val < min_val or val > max_val:
            raise ValueError(f"{name} must be between {min_val} and {max_val}, got {val}")
        return val
    except ValueError as e:
        raise ValueError(f"Invalid {name}: {e}") from e


DEFAULT_RETRIES = parse_int_env("POLICY_DRIFT_RETRIES", 3, 1, 10)
DEFAULT_BACKOFF_SECONDS = parse_float_env("POLICY_DRIFT_BACKOFF_SECONDS", 1.0, 0.0, 60.0)
DEFAULT_TIMEOUT_SECONDS = parse_float_env("POLICY_DRIFT_TIMEOUT_SECONDS", 30.0, 1.0, 300.0)

SEPARATOR = "\n---\n\n"


def fetch_text(
    url: str,
    retries: int = DEFAULT_RETRIES,
    backoff_seconds: float = DEFAULT_BACKOFF_SECONDS,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> str:
    """Fetch text from a URL with retry attempts and exponential backoff."""
    request = urllib.request.Request(url, headers={"User-Agent": "kiawaBot-CI"})
    last_error: Exception | None = None
    delay = backoff_seconds
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < retries:
                print(
                    f"Fetch attempt {attempt}/{retries} failed for {url} ({error}); retrying in {delay:.1f}s...",
                    file=sys.stderr,
                )
                time.sleep(delay)
                delay *= 2.0
    raise urllib.error.URLError(f"Failed after {retries} attempts: {last_error}")


def extract_embedded_policy(doc_path: Path) -> str:
    """Extract policy section following the separator delimiter."""
    content = doc_path.read_text(encoding="utf-8")
    if SEPARATOR not in content:
        raise ValueError(f"Missing delimiter in {doc_path}")
    _preamble, policy = content.split(SEPARATOR, 1)
    return policy.rstrip() + "\n"


def verify_policy(doc_path: Path, upstream_url: str, name: str) -> bool:
    """Verify that local embedded policy matches upstream content."""
    print(f"Checking {name} policy against upstream...")
    try:
        upstream_text = fetch_text(upstream_url).rstrip() + "\n"
    except (urllib.error.URLError, UnicodeDecodeError, TimeoutError) as error:
        print(f"::error::Failed to fetch upstream {name} from {upstream_url}: {error}")
        return False

    if not doc_path.is_file():
        print(f"::error file={doc_path}::Policy documentation file {doc_path} not found")
        return False

    try:
        embedded_text = extract_embedded_policy(doc_path)
    except (OSError, ValueError) as error:
        print(f"::error file={doc_path}::Failed to extract embedded {name} policy: {error}")
        return False

    if embedded_text != upstream_text:
        print(f"::error file={doc_path}::Embedded {name} policy does not match upstream at {upstream_url}")
        return False

    print(f"SUCCESS: {name} policy matches upstream specification.")
    return True


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    quality_doc = repo_root / "docs" / "pr-quality-review.md"
    security_doc = repo_root / "docs" / "pr-security-review.md"

    ok_quality = verify_policy(quality_doc, EULER_URL, "Euler QUALITY.md")
    ok_security = verify_policy(security_doc, FOUCAULT_URL, "Foucault AUDIT.md")

    if not (ok_quality and ok_security):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
