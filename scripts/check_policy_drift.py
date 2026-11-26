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
from typing import NamedTuple

DEFAULT_UPSTREAM_HOST = "raw.githubusercontent.com"
DEFAULT_POLICY_ORG = "abuzucom"
DEFAULT_PERSONAS_REPO = "agents-personas"
PINNED_PERSONAS_REF = "1649e5c9710fd85d6cca12006e344af27a5404a6"

DEFAULT_PERSONAS_REF = PINNED_PERSONAS_REF

SEPARATOR = "\n---\n\n"
POLICY_MARKER_PREFIX = "<!-- upstream-policy: "
POLICY_MARKER_SUFFIX = " -->"

RETIRED_POLICY_ENVIRONMENT_NAMES = (
    "EULER_POLICY_URL",
    "EULER_POLICY_REF",
    "EULER_POLICY_PIN",
    "FOUCAULT_POLICY_URL",
    "FOUCAULT_POLICY_REF",
    "FOUCAULT_POLICY_PIN",
)

REF_PATTERN = re.compile(r"^(?:[0-9a-fA-F]{40}|main|v[0-9]+(?:\.[0-9]+)*)$")


class PolicyDocument(NamedTuple):
    """One local policy document and the upstream files that fill it."""

    doc_path: str
    name: str
    upstream_paths: tuple[str, ...]
    digests: tuple[str, ...]


# One entry per local policy document. Each entry names the local document, the
# upstream repository path of every file that forms the persona prompt, and the
# SHA-256 digest of each upstream file.
DOCUMENTS = (
    PolicyDocument(
        "docs/pr-quality-review.md",
        "agents-personas QUALITY.md",
        ("reviewers/euler/QUALITY.md",),
        ("b12761bb1beec01de1e89e225069caf05dbf86353f7fe86bef4e36f5a8f2226d",),
    ),
    PolicyDocument(
        "docs/pr-security-review.md",
        "agents-personas AUDIT.md",
        ("reviewers/foucault/AUDIT.md",),
        ("98c66b3f1cae20312164d124b25df135046e7ca3896f8804ce4cee0659782ad1",),
    ),
    PolicyDocument(
        "docs/pr-time-review.md",
        "agents-personas generay time policy",
        ("reviewers/generay/TIME.md", "reviewers/generay/SYNC.md"),
        (
            "9094933fb3a08c6b8f540d226f169308f6bf44ef5ad5dd32e0097d901d6fc9d7",
            "7743e74daba5d4a74533c4d05d63868df25647fd2196bf77b00c5cce907ff367",
        ),
    ),
    PolicyDocument(
        "docs/pr-ui-review.md",
        "agents-personas adorno ui policy",
        ("reviewers/adorno/bundles/ui-full.md",),
        ("394bc982c58672213afa53dc7a678c65e7a1c64d0d1a078829a6bb8aa9dc7d08",),
    ),
    PolicyDocument(
        "docs/pr-privacy-review.md",
        "agents-personas havel privacy policy",
        ("reviewers/havel/bundles/all-full.md",),
        ("54678326a00f34b23fb19be85c54d8db9200a343affb4d61e4c812122272aa0b",),
    ),
)

# The upstream paths the drift check may fetch. Every path in every policy
# document must appear here.
APPROVED_POLICY_PATHS = frozenset(
    path for document in DOCUMENTS for path in document.upstream_paths
)


def validate_policy_ref(ref: str, name: str) -> str:
    """Validate that the policy git ref is safe."""
    if not REF_PATTERN.match(ref) or ".." in ref:
        raise ValueError(f"Invalid {name} ref: {ref}")
    return ref


def validate_policy_base_url(
    url: str,
    name: str,
    expected_host: str = DEFAULT_UPSTREAM_HOST,
    expected_org: str = DEFAULT_POLICY_ORG,
) -> str:
    """Validate that the upstream base URL points to an approved location."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Invalid scheme for {name} URL: {url} (must use https)")
    if parsed.netloc != DEFAULT_UPSTREAM_HOST:
        raise ValueError(f"Invalid host for {name} URL: {url} (must be {DEFAULT_UPSTREAM_HOST})")
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError(f"Invalid {name} URL: {url} (must not carry a query or credentials)")
    if ".." in parsed.path or "%2e" in parsed.path.lower():
        raise ValueError(f"Path traversal detected in {name} URL: {url}")
    pattern = (
        rf"^/{re.escape(expected_org)}/{re.escape(DEFAULT_PERSONAS_REPO)}/"
        rf"([0-9a-fA-F]{{40}}|main|v[0-9]+(?:\.[0-9]+)*)$"
    )
    if not re.fullmatch(pattern, parsed.path):
        raise ValueError(
            f"Invalid path for {name} URL: {url} "
            f"(must target {expected_org}/{DEFAULT_PERSONAS_REPO} at a commit)"
        )
    return url.rstrip("/")


def policy_file_url(base_url: str, upstream_path: str) -> str:
    """Return the upstream URL of one policy file."""
    if upstream_path not in APPROVED_POLICY_PATHS:
        raise ValueError(f"Unapproved upstream policy path: {upstream_path}")
    return f"{base_url}/{upstream_path}"


DEFAULT_RETRIES = 3
DEFAULT_BACKOFF_SECONDS = 1.0
DEFAULT_TIMEOUT_SECONDS = 30.0


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


def get_policy_config() -> tuple[str, str, int, float, float]:
    """Retrieve and validate the upstream location and parameters."""
    for retired_name in RETIRED_POLICY_ENVIRONMENT_NAMES:
        if retired_name in os.environ:
            raise ValueError(
                f"{retired_name} names a retired upstream repository. "
                "Use PERSONAS_REF and PERSONAS_BASE_URL."
            )

    ref = validate_policy_ref(
        os.getenv("PERSONAS_REF", DEFAULT_PERSONAS_REF),
        "agents-personas",
    )
    default_base_url = (
        f"https://{DEFAULT_UPSTREAM_HOST}/{DEFAULT_POLICY_ORG}/"
        f"{DEFAULT_PERSONAS_REPO}/{ref}"
    )
    base_url = validate_policy_base_url(
        os.getenv("PERSONAS_BASE_URL", default_base_url),
        "agents-personas",
    )

    retries = parse_int_env("POLICY_DRIFT_RETRIES", DEFAULT_RETRIES, 1, 10)
    backoff = parse_float_env("POLICY_DRIFT_BACKOFF_SECONDS", DEFAULT_BACKOFF_SECONDS, 0.0, 60.0)
    timeout = parse_float_env("POLICY_DRIFT_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, 1.0, 300.0)

    return base_url, ref, retries, backoff, timeout


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


def _marker_path(line: str) -> str | None:
    """Return the upstream path named by a policy marker line."""
    if line.startswith(POLICY_MARKER_PREFIX) and line.endswith(POLICY_MARKER_SUFFIX):
        return line[len(POLICY_MARKER_PREFIX):-len(POLICY_MARKER_SUFFIX)].strip()
    return None


def extract_embedded_policy(doc_path: Path) -> dict[str, str]:
    """Return the embedded text of every upstream policy file in the document."""
    content = doc_path.read_text(encoding="utf-8")
    if SEPARATOR not in content:
        raise ValueError(f"Missing delimiter in {doc_path}")
    _preamble, body = content.split(SEPARATOR, 1)

    blocks: dict[str, str] = {}
    current: str | None = None
    lines: list[str] = []
    for line in body.split("\n"):
        marker = _marker_path(line)
        if marker is not None:
            if current is not None:
                blocks[current] = "\n".join(lines).rstrip() + "\n"
            current = marker
            lines = []
        elif current is not None:
            lines.append(line)
    if current is not None:
        blocks[current] = "\n".join(lines).rstrip() + "\n"

    if not blocks:
        raise ValueError(f"Missing policy marker in {doc_path}")
    return blocks


def verify_policy(
    document: PolicyDocument,
    blocks: dict[str, str],
    base_url: str,
    retries: int = DEFAULT_RETRIES,
    backoff_seconds: float = DEFAULT_BACKOFF_SECONDS,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> bool:
    """Verify that every embedded policy file matches its upstream content."""
    import hashlib

    print(f"Checking {document.name} policy against upstream...")
    for upstream_path, expected_sha256 in zip(document.upstream_paths, document.digests):
        url = policy_file_url(base_url, upstream_path)
        try:
            upstream_text = fetch_text(
                url,
                retries=retries,
                backoff_seconds=backoff_seconds,
                timeout=timeout,
            ).rstrip() + "\n"
        except (urllib.error.URLError, UnicodeDecodeError, TimeoutError) as error:
            print(f"::error::Failed to fetch upstream {upstream_path} from {url}: {error}")
            return False

        upstream_sha256 = hashlib.sha256(upstream_text.encode("utf-8")).hexdigest()
        if upstream_sha256 != expected_sha256:
            print(
                f"::error::Cryptographic integrity verification failed for upstream "
                f"{upstream_path}: expected SHA-256 {expected_sha256}, got {upstream_sha256}",
                file=sys.stderr,
            )
            return False

        embedded_text = blocks.get(upstream_path)
        if embedded_text is None:
            print(
                f"::error file={document.doc_path}::Missing embedded policy block for "
                f"{upstream_path}",
            )
            return False

        embedded_sha256 = hashlib.sha256(embedded_text.encode("utf-8")).hexdigest()
        if embedded_sha256 != expected_sha256:
            print(
                f"::error file={document.doc_path}::Cryptographic integrity verification "
                f"failed for local {upstream_path}: expected SHA-256 {expected_sha256}, "
                f"got {embedded_sha256}",
                file=sys.stderr,
            )
            return False

        if embedded_text != upstream_text:
            print(
                f"::error file={document.doc_path}::Embedded {upstream_path} does not match "
                f"upstream at {url} (local SHA-256: {embedded_sha256}, upstream SHA-256: "
                f"{upstream_sha256})"
            )
            return False

    print(
        f"SUCCESS: {document.name} policy matches upstream specification "
        f"({len(document.upstream_paths)} file(s))."
    )
    return True


def main() -> int:
    try:
        base_url, _ref, retries, backoff, timeout = get_policy_config()
    except ValueError as error:
        print(f"::error::Policy configuration error: {error}", file=sys.stderr)
        return 1

    repo_root = Path(__file__).resolve().parent.parent
    results = []
    for document in DOCUMENTS:
        doc_path = repo_root / document.doc_path
        if not doc_path.is_file():
            print(f"::error file={document.doc_path}::Policy documentation file {doc_path} not found")
            results.append(False)
            continue
        try:
            blocks = extract_embedded_policy(doc_path)
        except (OSError, ValueError) as error:
            print(f"::error file={document.doc_path}::Failed to extract embedded policy: {error}")
            results.append(False)
            continue
        results.append(
            verify_policy(
                document,
                blocks,
                base_url,
                retries=retries,
                backoff_seconds=backoff,
                timeout=timeout,
            )
        )

    if not all(results):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
