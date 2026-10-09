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

    def test_api_key_resolution_supports_ollama_and_model_keys(self) -> None:
        import os
        from ci.call_model import _get_api_key, ProviderError

        orig_model = os.environ.get("MODEL_API_KEY")
        orig_ollama = os.environ.get("OLLAMA_API_KEY")
        try:
            # Case 1: MODEL_API_KEY present
            os.environ["MODEL_API_KEY"] = "model-secret"
            os.environ.pop("OLLAMA_API_KEY", None)
            self.assertEqual(_get_api_key(), "model-secret")

            # Case 2: Only OLLAMA_API_KEY present
            os.environ.pop("MODEL_API_KEY", None)
            os.environ["OLLAMA_API_KEY"] = "ollama-secret"
            self.assertEqual(_get_api_key(), "ollama-secret")

            # Case 3: Neither present
            os.environ.pop("MODEL_API_KEY", None)
            os.environ.pop("OLLAMA_API_KEY", None)
            with self.assertRaises(ProviderError):
                _get_api_key()
        finally:
            if orig_model is not None:
                os.environ["MODEL_API_KEY"] = orig_model
            else:
                os.environ.pop("MODEL_API_KEY", None)
            if orig_ollama is not None:
                os.environ["OLLAMA_API_KEY"] = orig_ollama
            else:
                os.environ.pop("OLLAMA_API_KEY", None)


if __name__ == "__main__":
    unittest.main()

