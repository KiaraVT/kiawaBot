#!/usr/bin/env python3
"""Inspect npm audit output, verifying all findings match known baseline advisory IDs.

Baseline advisory maintenance:
- RAW_BASELINE_ADVISORIES contains known grandfathered advisories from existing dependencies.
- When new vulnerabilities appear, they block CI and must be resolved by updating dependencies.
- To triage a new advisory, verify if Dependabot or manual upgrade can remediate the package.
- If an advisory cannot be upgraded immediately due to breaking changes, maintainers may
  explicitly add the verified GHSA ID to this baseline list with documented rationale.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

GHSA_PATTERN = re.compile(r"GHSA-[a-z0-9-]+", re.IGNORECASE)
CVE_PATTERN = re.compile(r"CVE-\d{4}-\d{4,}", re.IGNORECASE)


def _extract_advisory_id(item: Any) -> str | None:
    if isinstance(item, str) and item.strip():
        return item.strip().lower()
    if isinstance(item, dict):
        val = item.get("id") or item.get("ghsa_id") or item.get("cve")
        if val and isinstance(val, str) and val.strip():
            return val.strip().lower()
    return None

# Canonical baseline advisories are stored in scripts/npm-audit-baseline.json
RAW_BASELINE_ADVISORIES: list[str] = []


def load_baseline_advisories() -> set[str]:
    """Load approved baseline advisories from environment, JSON file, or fallback."""
    env_list = os.getenv("NPM_AUDIT_BASELINE_ADVISORIES")
    if env_list:
        return {a.strip().lower() for a in env_list.split(",") if a.strip()}

    baseline_env_file = os.getenv("NPM_AUDIT_BASELINE_FILE")
    candidate_paths = [
        Path(baseline_env_file) if baseline_env_file else None,
        Path(__file__).resolve().parent / "npm-audit-baseline.json",
        Path(__file__).resolve().parent.parent / "npm-audit-baseline.json",
    ]
    for candidate in candidate_paths:
        if candidate and candidate.is_file():
            try:
                content = json.loads(candidate.read_text(encoding="utf-8"))
                if isinstance(content, list):
                    advisories = set()
                    for item in content:
                        extracted = _extract_advisory_id(item)
                        if extracted:
                            advisories.add(extracted)
                    return advisories
            except (OSError, json.JSONDecodeError) as error:
                print(f"::warning::Failed to load {candidate}: {error}", file=sys.stderr)

    return {a.lower() for a in RAW_BASELINE_ADVISORIES}


KNOWN_BASELINE_ADVISORIES = load_baseline_advisories()
DEFAULT_AUDIT_TIMEOUT_SECONDS = 300


def run_audit(timeout: int = DEFAULT_AUDIT_TIMEOUT_SECONDS) -> dict:
    npm_path = shutil.which("npm") or "npm"
    result = subprocess.run(
        [npm_path, "audit", "--json"],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )
    if not result.stdout.strip():
        stderr_msg = result.stderr.strip() or f"Process exited with code {result.returncode}."
        raise RuntimeError(f"npm audit produced no JSON output: {stderr_msg}")

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        stderr_msg = result.stderr.strip()
        context = f" (stderr: {stderr_msg})" if stderr_msg else ""
        raise json.JSONDecodeError(f"{error.msg}{context}", error.doc, error.pos) from error

    if isinstance(data, dict) and "error" in data:
        err_info = data["error"]
        summary = err_info.get("summary", err_info) if isinstance(err_info, dict) else err_info
        raise RuntimeError(f"npm audit reported an error: {summary}")

    return data


def audit_dependencies(data: dict, baseline: set[str] | None = None) -> int:
    active_baseline = baseline if baseline is not None else load_baseline_advisories()
    vulnerabilities = data.get("vulnerabilities", {})
    new_advisories: list[str] = []
    known_count = 0

    for pkg_name, details in vulnerabilities.items():
        via_list = details.get("via", [])
        for item in via_list:
            if isinstance(item, str):
                continue

            if not isinstance(item, dict):
                print(
                    f"::error::[npm-audit] Unidentifiable advisory entry in {pkg_name}: {item!r}",
                    file=sys.stderr,
                )
                new_advisories.append(f"{pkg_name}: {item!r}")
                continue

            url = item.get("url", "")
            title = item.get("title", "Unknown advisory")
            source = str(item.get("source", ""))
            cve_field = str(item.get("cve", ""))

            ghsa_match = GHSA_PATTERN.search(url) or GHSA_PATTERN.search(source)
            cve_match = (
                CVE_PATTERN.search(url)
                or CVE_PATTERN.search(cve_field)
                or CVE_PATTERN.search(source)
            )

            advisory_id = ""
            if ghsa_match:
                advisory_id = ghsa_match.group(0).lower()
            elif cve_match:
                advisory_id = cve_match.group(0).lower()

            if not advisory_id:
                advisory_ref = url or source or cve_field or "unidentifiable-advisory"
                print(
                    f"::error::[npm-audit] Unidentifiable vulnerability in {pkg_name}: {title} ({advisory_ref})",
                    file=sys.stderr,
                )
                new_advisories.append(f"{pkg_name}: {advisory_ref}")
                continue

            if advisory_id in active_baseline:
                print(f"::warning::[npm-audit] Known legacy advisory in {pkg_name}: {title} ({advisory_id})")
                known_count += 1
            else:
                print(
                    f"::error::[npm-audit] New or unapproved vulnerability in {pkg_name}: {title} ({advisory_id})",
                    file=sys.stderr,
                )
                new_advisories.append(f"{pkg_name}: {advisory_id}")

    if new_advisories:
        print(
            f"FAILED: Found {len(new_advisories)} unapproved advisory/advisories not in baseline: {', '.join(new_advisories)}",
            file=sys.stderr,
        )
        return 1

    print(f"SUCCESS: npm audit checked ({known_count} legacy findings verified against baseline advisories)")
    return 0


def main() -> int:
    try:
        data = run_audit()
    except (subprocess.SubprocessError, OSError, RuntimeError, json.JSONDecodeError) as error:
        print(f"::error::Failed to execute npm audit or parse output: {error}", file=sys.stderr)
        return 1
    return audit_dependencies(data)


if __name__ == "__main__":
    raise SystemExit(main())
