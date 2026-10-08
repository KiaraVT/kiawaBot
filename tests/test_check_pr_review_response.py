from __future__ import annotations

import json
import unittest

from scripts.check_pr_review_response import ResponseError, validate_response


def _make_response(verdict: str, findings: list[dict[str, object]]) -> str:
    payload = {
        "mode": "PR",
        "verdict": verdict,
        "findings": findings,
    }
    return f"VERDICT_JSON: {json.dumps(payload)}\nVERDICT: {verdict}\n"


class TestCheckPRReviewResponse(unittest.TestCase):
    def test_approve_empty_findings(self) -> None:
        response = _make_response("APPROVE", [])
        verdict, payload = validate_response(response)
        self.assertEqual(verdict, "APPROVE")
        self.assertEqual(payload["findings"], [])

    def test_approve_with_medium_or_low_findings(self) -> None:
        findings: list[dict[str, object]] = [
            {
                "severity": "LOW",
                "class": "2.1",
                "file": "test.js",
                "line": 10,
                "title": "Minor style issue",
            },
            {
                "severity": "MEDIUM",
                "class": "2.5",
                "file": "test.js",
                "line": 20,
                "title": "Moderate concern",
            },
        ]
        response = _make_response("APPROVE", findings)
        verdict, payload = validate_response(response)
        self.assertEqual(verdict, "APPROVE")
        self.assertEqual(len(payload["findings"]), 2)

    def test_approve_with_high_severity_raises_error(self) -> None:
        findings: list[dict[str, object]] = [
            {
                "severity": "HIGH",
                "class": "2.6",
                "file": "server.js",
                "line": 42,
                "title": "High severity security issue",
            }
        ]
        response = _make_response("APPROVE", findings)
        with self.assertRaises(ResponseError) as ctx:
            validate_response(response)
        self.assertIn("APPROVE verdict cannot contain HIGH or CRITICAL findings", str(ctx.exception))

    def test_approve_with_critical_severity_raises_error(self) -> None:
        findings: list[dict[str, object]] = [
            {
                "severity": "CRITICAL",
                "class": "2.3",
                "file": "server.js",
                "line": 15,
                "title": "Remote code execution",
            }
        ]
        response = _make_response("APPROVE", findings)
        with self.assertRaises(ResponseError) as ctx:
            validate_response(response)
        self.assertIn("APPROVE verdict cannot contain HIGH or CRITICAL findings", str(ctx.exception))

    def test_block_with_high_severity_passes(self) -> None:
        findings: list[dict[str, object]] = [
            {
                "severity": "HIGH",
                "class": "2.6",
                "file": "server.js",
                "line": 42,
                "title": "High severity issue",
            }
        ]
        response = _make_response("BLOCK", findings)
        verdict, payload = validate_response(response)
        self.assertEqual(verdict, "BLOCK")
        self.assertEqual(len(payload["findings"]), 1)

    def test_mismatched_verdict_raises_error(self) -> None:
        payload = {
            "mode": "PR",
            "verdict": "APPROVE",
            "findings": [],
        }
        response = f"VERDICT_JSON: {json.dumps(payload)}\nVERDICT: BLOCK\n"
        with self.assertRaises(ResponseError):
            validate_response(response)

    def test_malformed_verdict_line_raises_error(self) -> None:
        response = "VERDICT_JSON: {}\nVERDICT: MAYBE\n"
        with self.assertRaises(ResponseError):
            validate_response(response)


if __name__ == "__main__":
    unittest.main()
