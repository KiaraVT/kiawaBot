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

    def test_validate_policy_pin(self) -> None:
        from scripts.check_policy_drift import validate_policy_pin
        valid_pin = "fcda240de46de3bd85e17cd49bdfa8a7f7cdbf08"
        self.assertEqual(validate_policy_pin(valid_pin, "Euler"), valid_pin)
        with self.assertRaises(ValueError):
            validate_policy_pin("short_or_invalid_pin", "Euler")

    def test_validate_policy_url(self) -> None:
        from scripts.check_policy_drift import validate_policy_url
        valid_url = "https://raw.githubusercontent.com/abuzucom/euler/fcda240de46de3bd85e17cd49bdfa8a7f7cdbf08/QUALITY.md"
        self.assertEqual(validate_policy_url(valid_url, "Euler"), valid_url)
        with self.assertRaises(ValueError):
            validate_policy_url("http://raw.githubusercontent.com/abuzucom/euler/pin/QUALITY.md", "Euler")
        with self.assertRaises(ValueError):
            validate_policy_url("https://attacker.com/abuzucom/euler/pin/QUALITY.md", "Euler")
        with self.assertRaises(ValueError):
            validate_policy_url("https://raw.githubusercontent.com/malicious/euler/pin/QUALITY.md", "Euler")

    def test_env_var_configuration(self) -> None:
        import os
        custom_pin = "0123456789abcdef0123456789abcdef01234567"
        with patch.dict(os.environ, {"EULER_POLICY_PIN": custom_pin}):
            from importlib import reload
            import scripts.check_policy_drift as drift_mod
            reload(drift_mod)
            self.assertEqual(drift_mod.EULER_PIN, custom_pin)
            self.assertIn(custom_pin, drift_mod.EULER_URL)
        # Restore module state
        reload(drift_mod)


if __name__ == "__main__":
    unittest.main()
