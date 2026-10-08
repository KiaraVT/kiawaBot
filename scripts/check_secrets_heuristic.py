#!/usr/bin/env python3
"""Heuristic scanner for potential hardcoded secrets and credentials.

Note: This script provides lightweight heuristic scanning for fast local checks
and CI gates. Comprehensive git-history secret scanning is performed by Gitleaks.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

PATTERNS = [
    ("private_key", re.compile(r"-----BEGIN (?:RSA|EC|DSA|OPENSSH|PGP)?\s?PRIVATE KEY-----")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{36,}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[0-9A-Za-z]{10,48}\b")),
    ("generic_secret_assignment", re.compile(r"""(?i)\b(?:api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*(?:[`'"][A-Za-z0-9_\-]{16,64}[`'"]|[A-Za-z0-9_\-]{20,64})""")),
]

ALLOWLIST_PATHS = {
    Path(".env.example"),
    Path("tests"),
}


def is_allowed(path: Path) -> bool:
    for allowed in ALLOWLIST_PATHS:
        if path == allowed or allowed in path.parents:
            return True
    return False


DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB limit to prevent memory exhaustion in CI
MAX_FILE_BYTES = int(os.getenv("SECRETS_SCAN_MAX_BYTES", str(DEFAULT_MAX_FILE_BYTES)))


def scan_file(path: Path) -> list[tuple[int, str, str]]:
    findings: list[tuple[int, str, str]] = []
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            print(f"::warning file={path}::Skipped secret scanning for file exceeding 10 MB", file=sys.stderr)
            return findings
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError as error:
        print(f"::error file={path}::Failed to read file for secret scanning: {error}", file=sys.stderr)
        findings.append((1, "unreadable_file", f"Unreadable file: {error}"))
        return findings

    for line_number, line in enumerate(content.splitlines(), start=1):
        for name, pattern in PATTERNS:
            if pattern.search(line):
                findings.append((line_number, name, line.strip()[:100]))
    return findings


def get_tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        capture_output=True,
        check=True,
    )
    paths: list[Path] = []
    for raw in result.stdout.split(b"\x00"):
        if raw:
            paths.append(Path(raw.decode("utf-8", errors="replace")))
    return paths


def main() -> int:
    tracked = get_tracked_files()
    secret_findings = 0
    io_errors = 0
    for path in tracked:
        if is_allowed(path):
            continue
        findings = scan_file(path)
        for line_num, rule_name, sample in findings:
            if rule_name == "unreadable_file":
                print(f"::error file={path},line={line_num}::Failed to read file: {sample}", file=sys.stderr)
                io_errors += 1
            else:
                print(f"::error file={path},line={line_num}::Secret pattern matched ({rule_name})")
                secret_findings += 1

    if secret_findings > 0:
        print(f"FAILED: Found {secret_findings} potential secret(s) in repository", file=sys.stderr)
        return 1
    if io_errors > 0:
        print(f"FAILED: Encountered {io_errors} unreadable file(s) during scan", file=sys.stderr)
        return 2
    print("SUCCESS: No secrets detected in tracked files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
