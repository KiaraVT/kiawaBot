#!/usr/bin/env python3
"""Verify that local policy documentation matches pinned upstream specifications."""

from __future__ import annotations

import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

EULER_PIN = "fcda240de46de3bd85e17cd49bdfa8a7f7cdbf08"
FOUCAULT_PIN = "f59866d6e3ff71affa8404117877b58b8d79eea2"

EULER_URL = f"https://raw.githubusercontent.com/abuzucom/euler/{EULER_PIN}/QUALITY.md"
FOUCAULT_URL = f"https://raw.githubusercontent.com/abuzucom/foucault/{FOUCAULT_PIN}/AUDIT.md"

SEPARATOR = "\n---\n\n"


def fetch_text(url: str, retries: int = 3, backoff_seconds: float = 1.0) -> str:
    """Fetch text from a URL with retry attempts and exponential backoff."""
    request = urllib.request.Request(url, headers={"User-Agent": "kiawaBot-CI"})
    last_error: Exception | None = None
    delay = backoff_seconds
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < retries:
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

    try:
        embedded_text = extract_embedded_policy(doc_path)
    except (OSError, ValueError) as error:
        print(f"::error file={doc_path}::Failed to extract embedded {name} policy: {error}")
        return False

    if embedded_text != upstream_text:
        print(f"::error file={doc_path}::Embedded {name} policy does not match upstream at pinned commit")
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
