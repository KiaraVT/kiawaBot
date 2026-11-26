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

DEFAULT_UPSTREAM_HOST = "raw.githubusercontent.com"
DEFAULT_POLICY_ORG = "abuzucom"
DEFAULT_PERSONAS_REPO = "agents-personas"
QUALITY_POLICY_PATH = "reviewers/euler/QUALITY.md"
AUDIT_POLICY_PATH = "reviewers/foucault/AUDIT.md"
PINNED_PERSONAS_REF = "1649e5c9710fd85d6cca12006e344af27a5404a6"

DEFAULT_PERSONAS_REF = PINNED_PERSONAS_REF

PINNED_QUALITY_SHA256 = "b12761bb1beec01de1e89e225069caf05dbf86353f7fe86bef4e36f5a8f2226d"
PINNED_AUDIT_SHA256 = "98c66b3f1cae20312164d124b25df135046e7ca3896f8804ce4cee0659782ad1"

REF_PATTERN = re.compile(r"^(?:[0-9a-fA-F]{40}|main|v[0-9]+(?:\.[0-9]+)*)$")


def validate_policy_ref(ref: str, name: str) -> str:
    """Validate that the policy git ref is safe."""
    if not REF_PATTERN.match(ref) or ".." in ref:
        raise ValueError(f"Invalid {name} ref: {ref}")
    return ref


def validate_policy_url(
    url: str,
    name: str,
    expected_host: str = DEFAULT_UPSTREAM_HOST,
    expected_org: str = DEFAULT_POLICY_ORG,
) -> str:
    """Validate that policy URL points to an approved HTTPS GitHub location."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Invalid scheme for {name} URL: {url} (must use https)")
    if parsed.netloc != DEFAULT_UPSTREAM_HOST:
        raise ValueError(f"Invalid host for {name} URL: {url} (must be {DEFAULT_UPSTREAM_HOST})")
    if ".." in parsed.path or "%2e" in parsed.path.lower():
        raise ValueError(f"Path traversal detected in {name} URL: {url}")
    pattern = (
        rf"^/{re.escape(expected_org)}/"
        rf"{re.escape(DEFAULT_PERSONAS_REPO)}/"
        rf"([0-9a-fA-F]{{40}}|main|v[0-9]+(?:\.[0-9]+)*)/"
        rf"({re.escape(QUALITY_POLICY_PATH)}|{re.escape(AUDIT_POLICY_PATH)})$"
    )
    if not re.fullmatch(pattern, parsed.path):
        raise ValueError(f"Invalid path for {name} URL: {url} (must target approved abuzucom policy document)")
    return url


DEFAULT_RETRIES = 3
DEFAULT_BACKOFF_SECONDS = 1.0
DEFAULT_TIMEOUT_SECONDS = 30.0
SEPARATOR = "\n---\n\n"


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


RETIRED_POLICY_ENVIRONMENT_NAMES = (
    "EULER_POLICY_URL",
    "EULER_POLICY_REF",
    "EULER_POLICY_PIN",
    "FOUCAULT_POLICY_URL",
    "FOUCAULT_POLICY_REF",
    "FOUCAULT_POLICY_PIN",
)


def get_policy_config() -> tuple[str, str, int, float, float]:
    """Retrieve and validate policy URLs and parameters from the environment."""
    for retired_name in RETIRED_POLICY_ENVIRONMENT_NAMES:
        if retired_name in os.environ:
            raise ValueError(
                f"{retired_name} names a retired upstream repository. "
                "Use PERSONAS_QUALITY_URL, PERSONAS_QUALITY_REF, "
                "PERSONAS_AUDIT_URL, and PERSONAS_AUDIT_REF."
            )

    quality_ref = validate_policy_ref(
        os.getenv("PERSONAS_QUALITY_REF", os.getenv("PERSONAS_QUALITY_PIN", DEFAULT_PERSONAS_REF)),
        "agents-personas quality policy",
    )
    audit_ref = validate_policy_ref(
        os.getenv("PERSONAS_AUDIT_REF", os.getenv("PERSONAS_AUDIT_PIN", DEFAULT_PERSONAS_REF)),
        "agents-personas audit policy",
    )

    default_quality_url = (
        f"https://{DEFAULT_UPSTREAM_HOST}/{DEFAULT_POLICY_ORG}/"
        f"{DEFAULT_PERSONAS_REPO}/{quality_ref}/{QUALITY_POLICY_PATH}"
    )
    default_audit_url = (
        f"https://{DEFAULT_UPSTREAM_HOST}/{DEFAULT_POLICY_ORG}/"
        f"{DEFAULT_PERSONAS_REPO}/{audit_ref}/{AUDIT_POLICY_PATH}"
    )

    quality_url = validate_policy_url(
        os.getenv("PERSONAS_QUALITY_URL", default_quality_url),
        "agents-personas quality policy",
    )
    audit_url = validate_policy_url(
        os.getenv("PERSONAS_AUDIT_URL", default_audit_url),
        "agents-personas audit policy",
    )

    retries = parse_int_env("POLICY_DRIFT_RETRIES", DEFAULT_RETRIES, 1, 10)
    backoff = parse_float_env("POLICY_DRIFT_BACKOFF_SECONDS", DEFAULT_BACKOFF_SECONDS, 0.0, 60.0)
    timeout = parse_float_env("POLICY_DRIFT_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, 1.0, 300.0)

    return quality_url, audit_url, retries, backoff, timeout


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


def verify_policy(
    doc_path: Path,
    upstream_url: str,
    name: str,
    expected_sha256: str | None = None,
    retries: int = DEFAULT_RETRIES,
    backoff_seconds: float = DEFAULT_BACKOFF_SECONDS,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> bool:
    """Verify that local embedded policy matches upstream content with SHA-256 integrity."""
    import hashlib

    print(f"Checking {name} policy against upstream...")
    try:
        upstream_text = fetch_text(
            upstream_url,
            retries=retries,
            backoff_seconds=backoff_seconds,
            timeout=timeout,
        ).rstrip() + "\n"
    except (urllib.error.URLError, UnicodeDecodeError, TimeoutError) as error:
        print(f"::error::Failed to fetch upstream {name} from {upstream_url}: {error}")
        return False

    upstream_sha256 = hashlib.sha256(upstream_text.encode("utf-8")).hexdigest()

    if expected_sha256 and upstream_sha256 != expected_sha256:
        print(
            f"::error::Cryptographic integrity verification failed for upstream {name}: "
            f"expected SHA-256 {expected_sha256}, got {upstream_sha256}",
            file=sys.stderr,
        )
        return False

    if not doc_path.is_file():
        print(f"::error file={doc_path}::Policy documentation file {doc_path} not found")
        return False

    try:
        embedded_text = extract_embedded_policy(doc_path)
    except (OSError, ValueError) as error:
        print(f"::error file={doc_path}::Failed to extract embedded {name} policy: {error}")
        return False

    embedded_sha256 = hashlib.sha256(embedded_text.encode("utf-8")).hexdigest()

    if expected_sha256 and embedded_sha256 != expected_sha256:
        print(
            f"::error file={doc_path}::Cryptographic integrity verification failed for local {name}: "
            f"expected SHA-256 {expected_sha256}, got {embedded_sha256}",
            file=sys.stderr,
        )
        return False

    if embedded_text != upstream_text:
        print(
            f"::error file={doc_path}::Embedded {name} policy does not match upstream at {upstream_url} "
            f"(local SHA-256: {embedded_sha256}, upstream SHA-256: {upstream_sha256})"
        )
        return False

    print(f"SUCCESS: {name} policy matches upstream specification (SHA-256: {upstream_sha256}).")
    return True


def main() -> int:
    try:
        quality_url, audit_url, retries, backoff, timeout = get_policy_config()
    except ValueError as error:
        print(f"::error::Policy configuration error: {error}", file=sys.stderr)
        return 1

    repo_root = Path(__file__).resolve().parent.parent
    quality_doc = repo_root / "docs" / "pr-quality-review.md"
    security_doc = repo_root / "docs" / "pr-security-review.md"

    ok_quality = verify_policy(
        quality_doc,
        quality_url,
        "agents-personas QUALITY.md",
        expected_sha256=PINNED_QUALITY_SHA256,
        retries=retries,
        backoff_seconds=backoff,
        timeout=timeout,
    )
    ok_audit = verify_policy(
        security_doc,
        audit_url,
        "agents-personas AUDIT.md",
        expected_sha256=PINNED_AUDIT_SHA256,
        retries=retries,
        backoff_seconds=backoff,
        timeout=timeout,
    )

    if not (ok_quality and ok_audit):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
