#!/usr/bin/env python3
"""Sync AGENTS.md to tool-specific copies. --check verifies without writing."""
import shutil
import sys
from pathlib import Path

SOURCE = "AGENTS.md"
COPIES = [
    "CLAUDE.md",
    "GEMINI.md",
    "CONVENTIONS.md",
    ".cursorrules",
    ".clinerules",
    ".windsurfrules",
    ".copilot-instructions",
    ".github/copilot-instructions.md",
]


def files_match(source: Path, target: Path) -> bool:
    """Compare file contents, normalizing line endings."""
    try:
        if not target.is_file():
            return False
        return (
            source.read_text(encoding="utf-8").replace("\r\n", "\n")
            == target.read_text(encoding="utf-8").replace("\r\n", "\n")
        )
    except (OSError, UnicodeDecodeError):
        return False


def sync_copies(check_only: bool) -> int:
    """Copy SOURCE over each target, or with --check report stale targets.

    Returns a process exit code: 0 on success, 1 if a check fails.
    """
    root = Path(__file__).resolve().parent.parent
    source = root / SOURCE
    if not source.is_file():
        print(f"error: {SOURCE} not found at {root}", file=sys.stderr)
        return 1

    stale = [
        name
        for name in COPIES
        if not files_match(source, root / name)
    ]

    if check_only:
        if stale:
            print(f"out of sync with {SOURCE}: {', '.join(stale)}", file=sys.stderr)
            print("run: make sync (or python scripts/sync.py)", file=sys.stderr)
            return 1
        print("all copies in sync")
        return 0

    for name in stale:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        print(f"synced {name}")
    if not stale:
        print("all copies already in sync")
    return 0


if __name__ == "__main__":
    sys.exit(sync_copies(check_only="--check" in sys.argv[1:]))
