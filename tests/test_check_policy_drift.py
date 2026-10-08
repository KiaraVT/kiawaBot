from __future__ import annotations

import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

from scripts.check_policy_drift import (
    SEPARATOR,
    extract_embedded_policy,
    fetch_text,
    verify_policy,
)


class TestCheckPolicyDrift(unittest.TestCase):
    def test_extract_embedded_policy(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(f"# Preamble\nSome text{SEPARATOR}# Policy Content\nRules here\n")
            temp_path = Path(f.name)
        try:
            extracted = extract_embedded_policy(temp_path)
            self.assertEqual(extracted, "# Policy Content\nRules here\n")
        finally:
            temp_path.unlink()

    def test_extract_embedded_policy_missing_separator_raises(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write("# Preamble only without separator\n")
            temp_path = Path(f.name)
        try:
            with self.assertRaises(ValueError):
                extract_embedded_policy(temp_path)
        finally:
            temp_path.unlink()

    def test_verify_policy_matching(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(f"# Preamble\nInfo{SEPARATOR}Policy text\n")
            temp_path = Path(f.name)
        try:
            with patch("scripts.check_policy_drift.fetch_text", return_value="Policy text\n"):
                ok = verify_policy(temp_path, "https://example.com/policy", "Test Policy")
                self.assertTrue(ok)
        finally:
            temp_path.unlink()

    def test_verify_policy_mismatch(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(f"# Preamble\nInfo{SEPARATOR}Local text\n")
            temp_path = Path(f.name)
        try:
            with patch("scripts.check_policy_drift.fetch_text", return_value="Upstream text\n"):
                ok = verify_policy(temp_path, "https://example.com/policy", "Test Policy")
                self.assertFalse(ok)
        finally:
            temp_path.unlink()

    def test_verify_policy_fetch_error(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(f"# Preamble\nInfo{SEPARATOR}Policy text\n")
            temp_path = Path(f.name)
        try:
            error = urllib.error.URLError("Network connection failed")
            with patch("scripts.check_policy_drift.fetch_text", side_effect=error):
                ok = verify_policy(temp_path, "https://example.com/policy", "Test Policy")
                self.assertFalse(ok)
        finally:
            temp_path.unlink()

    def test_fetch_text_retries_and_succeeds(self) -> None:
        mock_response = MagicMock()
        mock_response.read.return_value = b"remote content\n"
        mock_response.__enter__.return_value = mock_response

        error = urllib.error.URLError("Temporary outage")
        with patch("urllib.request.urlopen", side_effect=[error, error, mock_response]) as mock_urlopen:
            with patch("time.sleep") as mock_sleep:
                content = fetch_text("https://example.com/policy", retries=3, backoff_seconds=0.1)
                self.assertEqual(content, "remote content\n")
                self.assertEqual(mock_urlopen.call_count, 3)
                self.assertEqual(mock_sleep.call_count, 2)

    def test_fetch_text_retries_exhausted_raises(self) -> None:
        error = urllib.error.URLError("Persistent network error")
        with patch("urllib.request.urlopen", side_effect=error):
            with patch("time.sleep"):
                with self.assertRaises(urllib.error.URLError):
                    fetch_text("https://example.com/policy", retries=3, backoff_seconds=0.1)


if __name__ == "__main__":
    unittest.main()
