from __future__ import annotations

import unittest
from pathlib import Path

from ci.call_model import normalize_review_response
from scripts.check_pr_review_response import validate_response


class TestCallModelResponseNormalization(unittest.TestCase):
    def test_normalizes_bold_markdown_verdict_and_multi_class(self) -> None:
        raw_response = (
            "## Review Findings\n\n"
            "[HIGH] security-review-pr.yml:146 - Base SHA issue\n"
            "  What: Base sha issue.\n\n"
            "**VERDICT: BLOCK** — Base SHA fallback modifies diff.\n\n"
            'VERDICT_JSON: {"mode": "PR", "verdict": "BLOCK", "findings": ['
            '{"severity": "HIGH", "class": "2.8 / 2.13", "file": "foo.yml", "line": 146, "title": "Base SHA issue"}, '
            '{"severity": "LOW", "class": "4", "file": "bar.py", "line": 10, "title": "Test assertion issue"}'
            "]}\n"
        )
        normalized = normalize_review_response(raw_response)
        verdict, payload = validate_response(normalized)
        self.assertEqual(verdict, "BLOCK")
        self.assertEqual(len(payload["findings"]), 2)
        self.assertEqual(payload["findings"][0]["class"], "2.8")
        self.assertEqual(payload["findings"][1]["class"], "2.13")

    def test_leaves_clean_response_intact(self) -> None:
        clean_response = (
            "No findings.\n\n"
            "VERDICT: APPROVE - Clean changes\n"
            'VERDICT_JSON: {"findings": [], "mode": "PR", "verdict": "APPROVE"}\n'
        )
        normalized = normalize_review_response(clean_response)
        verdict, payload = validate_response(normalized)
        self.assertEqual(verdict, "APPROVE")
        self.assertEqual(payload["findings"], [])


if __name__ == "__main__":
    unittest.main()
