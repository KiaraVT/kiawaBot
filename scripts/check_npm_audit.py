#!/usr/bin/env python3
"""Inspect npm audit output, verifying all findings match known baseline advisory IDs."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys

GHSA_PATTERN = re.compile(r"GHSA-[a-z0-9-]+", re.IGNORECASE)

RAW_BASELINE_ADVISORIES = [
    "GHSA-27v5-c462-wpq7",
    "GHSA-35jp-ww65-95wh",
    "GHSA-37ch-88jc-xwx2",
    "GHSA-3g43-6gmg-66jw",
    "GHSA-3jxr-9vmj-r5cp",
    "GHSA-3p68-rc4w-qgx5",
    "GHSA-3pq3-5fj3-cg6v",
    "GHSA-3v7f-55p6-f55p",
    "GHSA-3w6x-2g7m-8v23",
    "GHSA-42h9-826w-cgv3",
    "GHSA-43fc-jf86-j433",
    "GHSA-445q-vr5w-6q77",
    "GHSA-4hqw-qxg8-jxx2",
    "GHSA-4mjr-xmp4-gh2g",
    "GHSA-542g-h47m-68v8",
    "GHSA-58qx-3vcg-4xpx",
    "GHSA-5c9x-8gcm-mpgx",
    "GHSA-62hf-57xw-28j9",
    "GHSA-6chq-wfr3-2hj9",
    "GHSA-6j4f-fj2g-mc7p",
    "GHSA-6rw7-vpxm-498p",
    "GHSA-777c-7fjr-54vf",
    "GHSA-7q8q-rj6j-mhjq",
    "GHSA-898c-q2cr-xwhg",
    "GHSA-96hv-2xvq-fx4p",
    "GHSA-9fr6-4gfg-395g",
    "GHSA-c2c7-rcm5-vvqj",
    "GHSA-f886-m6hf-6m8v",
    "GHSA-fvcv-3m26-pcqx",
    "GHSA-hfxv-24rg-xrqf",
    "GHSA-hmw2-7cc7-3qxx",
    "GHSA-j3q9-mxjg-w52f",
    "GHSA-j5f8-grm9-p9fc",
    "GHSA-j8rh-479h-cp32",
    "GHSA-jqcg-44mw-7w3h",
    "GHSA-jqh4-m9w3-8hp9",
    "GHSA-m7pr-hjqh-92cm",
    "GHSA-mh99-v99m-4gvg",
    "GHSA-mmx7-hfxf-jppx",
    "GHSA-mwf2-3pr3-8698",
    "GHSA-p92q-9vqr-4j8v",
    "GHSA-pf86-5x62-jrwf",
    "GHSA-pmv8-rq9r-6j72",
    "GHSA-pmwg-cvhr-8vh7",
    "GHSA-q2hr-2g5m-vwhr",
    "GHSA-q8mj-m7cp-5q26",
    "GHSA-q8qp-cvcw-x6jj",
    "GHSA-qhr7-859c-m2p7",
    "GHSA-r4q5-vmmm-2653",
    "GHSA-rgw5-rvv9-x895",
    "GHSA-v422-hmwv-36x6",
    "GHSA-vf2m-468p-8v99",
    "GHSA-vfj7-8cjw-p6xm",
    "GHSA-vh66-26gq-q6x8",
    "GHSA-w7fw-mjwx-w883",
    "GHSA-w9j2-pvgh-6h63",
    "GHSA-wqch-xfxh-vrr4",
    "GHSA-xhjh-pmcv-23jw",
    "GHSA-xffm-g5w8-qvg7",
    "GHSA-xx6v-rp6x-q39c",
]
KNOWN_BASELINE_ADVISORIES = {a.lower() for a in RAW_BASELINE_ADVISORIES}
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
    return json.loads(result.stdout)


def audit_dependencies(data: dict) -> int:
    vulnerabilities = data.get("vulnerabilities", {})
    new_advisories: list[str] = []
    known_count = 0

    for pkg_name, details in vulnerabilities.items():
        via_list = details.get("via", [])
        for item in via_list:
            if not isinstance(item, dict):
                continue
            url = item.get("url", "")
            title = item.get("title", "Unknown advisory")
            match = GHSA_PATTERN.search(url)
            ghsa_id = match.group(0).lower() if match else ""
            if not ghsa_id:
                continue

            if ghsa_id in KNOWN_BASELINE_ADVISORIES:
                print(f"::warning::[npm-audit] Known legacy advisory in {pkg_name}: {title} ({ghsa_id})")
                known_count += 1
            else:
                print(f"::error::[npm-audit] New or unapproved vulnerability in {pkg_name}: {title} ({ghsa_id})", file=sys.stderr)
                new_advisories.append(f"{pkg_name}: {ghsa_id}")

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
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError) as error:
        print(f"::error::Failed to execute npm audit or parse output: {error}", file=sys.stderr)
        return 1
    return audit_dependencies(data)


if __name__ == "__main__":
    raise SystemExit(main())
