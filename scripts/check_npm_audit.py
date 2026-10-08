#!/usr/bin/env python3
"""Inspect npm audit output, grandfathering legacy packages with warnings."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys

GRANDFATHERED_PACKAGES = {
    "axios",
    "body-parser",
    "brace-expansion",
    "braces",
    "chokidar",
    "express",
    "follow-redirects",
    "form-data",
    "nodemon",
    "path-to-regexp",
    "picomatch",
    "proxy-addr",
    "qs",
    "tesjs",
    "ws",
}
MAX_ALLOWED_VULNERABILITIES = 15


def run_audit() -> dict:
    npm_path = shutil.which("npm") or "npm"
    try:
        result = subprocess.run(
            [npm_path, "audit", "--json"],
            capture_output=True,
            text=True,
            check=False,
        )
        return json.loads(result.stdout)
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError) as error:
        print(f"::error::Failed to execute npm audit or parse output: {error}", file=sys.stderr)
        raise


def audit_dependencies(data: dict) -> int:
    vulnerabilities = data.get("vulnerabilities", {})
    metadata = data.get("metadata", {}).get("vulnerabilities", {})
    total_found = metadata.get("total", 0)

    unrecognized_packages: list[str] = []
    for pkg_name, details in vulnerabilities.items():
        severity = details.get("severity", "unknown")
        if pkg_name in GRANDFATHERED_PACKAGES:
            print(f"::warning::[npm-audit] Known legacy {severity} advisory in {pkg_name} (triaged via Dependabot)")
        else:
            print(f"::error::[npm-audit] New or unapproved {severity} vulnerability in {pkg_name}", file=sys.stderr)
            unrecognized_packages.append(pkg_name)

    if unrecognized_packages:
        print(
            f"FAILED: Found {len(unrecognized_packages)} new vulnerable package(s): {', '.join(unrecognized_packages)}",
            file=sys.stderr,
        )
        return 1

    if total_found > MAX_ALLOWED_VULNERABILITIES:
        print(
            f"FAILED: Total vulnerability count ({total_found}) exceeds baseline threshold ({MAX_ALLOWED_VULNERABILITIES})",
            file=sys.stderr,
        )
        return 1

    print(f"SUCCESS: npm audit checked ({total_found} known legacy advisories grandfathered as warnings)")
    return 0


def main() -> int:
    try:
        data = run_audit()
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        return 1
    return audit_dependencies(data)


if __name__ == "__main__":
    raise SystemExit(main())
