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

    def test_verify_policy_sha256_integrity_matching(self) -> None:
        import hashlib
        policy_content = "Policy text\n"
        expected_sha = hashlib.sha256(policy_content.encode("utf-8")).hexdigest()
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(f"# Preamble\nInfo{SEPARATOR}{policy_content}")
            temp_path = Path(f.name)
        try:
            with patch("scripts.check_policy_drift.fetch_text", return_value=policy_content):
                ok = verify_policy(
                    temp_path,
                    "https://example.com/policy",
                    "Test Policy",
                    expected_sha256=expected_sha,
                )
                self.assertTrue(ok)
        finally:
            temp_path.unlink()

    def test_verify_policy_sha256_integrity_mismatch_fails(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(f"# Preamble\nInfo{SEPARATOR}Policy text\n")
            temp_path = Path(f.name)
        try:
            with patch("scripts.check_policy_drift.fetch_text", return_value="Policy text\n"):
                wrong_sha = "0000000000000000000000000000000000000000000000000000000000000000"
                ok = verify_policy(
                    temp_path,
                    "https://example.com/policy",
                    "Test Policy",
                    expected_sha256=wrong_sha,
                )
                self.assertFalse(ok)
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

    def test_validate_policy_ref(self) -> None:
        from scripts.check_policy_drift import validate_policy_ref
        self.assertEqual(validate_policy_ref("main", "agents-personas"), "main")
        self.assertEqual(validate_policy_ref("v1.0.0", "agents-personas"), "v1.0.0")
        with self.assertRaises(ValueError):
            validate_policy_ref("../traversal", "agents-personas")

    def test_validate_policy_url(self) -> None:
        from scripts.check_policy_drift import validate_policy_url
        valid_url = (
            "https://raw.githubusercontent.com/abuzucom/agents-personas/main/"
            "reviewers/euler/QUALITY.md"
        )
        self.assertEqual(validate_policy_url(valid_url, "agents-personas"), valid_url)
        audit_url = (
            "https://raw.githubusercontent.com/abuzucom/agents-personas/v1.0.0/"
            "reviewers/foucault/AUDIT.md"
        )
        self.assertEqual(validate_policy_url(audit_url, "agents-personas"), audit_url)
        with self.assertRaises(ValueError):
            validate_policy_url(
                "http://raw.githubusercontent.com/abuzucom/agents-personas/main/reviewers/euler/QUALITY.md",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_url(
                "https://attacker.com/abuzucom/agents-personas/main/reviewers/euler/QUALITY.md",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_url(
                "https://raw.githubusercontent.com/malicious/agents-personas/main/reviewers/euler/QUALITY.md",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_url(
                "https://raw.githubusercontent.com/abuzucom/", "agents-personas"
            )
        with self.assertRaises(ValueError):
            validate_policy_url(
                "https://raw.githubusercontent.com/abuzucom/unapproved_repo/main/reviewers/euler/QUALITY.md",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_url(
                "https://raw.githubusercontent.com/abuzucom/agents-personas/main/../attacker/QUALITY.md",
                "agents-personas",
            )

    def test_validate_policy_url_rejects_retired_repositories(self) -> None:
        from scripts.check_policy_drift import validate_policy_url
        retired_urls = [
            "https://raw.githubusercontent.com/abuzucom/euler/main/QUALITY.md",
            "https://raw.githubusercontent.com/abuzucom/foucault/main/AUDIT.md",
            "https://raw.githubusercontent.com/abuzucom/agents-personas/main/QUALITY.md",
            "https://raw.githubusercontent.com/abuzucom/agents-personas/main/reviewers/euler/AUDIT.md",
        ]
        for retired_url in retired_urls:
            with self.subTest(url=retired_url):
                with self.assertRaises(ValueError):
                    validate_policy_url(retired_url, "agents-personas")

    def test_get_policy_config(self) -> None:
        from scripts.check_policy_drift import get_policy_config
        with patch.dict("os.environ", {}, clear=True):
            quality_url, audit_url, retries, backoff, timeout = get_policy_config()
            self.assertEqual(
                quality_url,
                "https://raw.githubusercontent.com/abuzucom/agents-personas/"
                "1649e5c9710fd85d6cca12006e344af27a5404a6/reviewers/euler/QUALITY.md",
            )
            self.assertEqual(
                audit_url,
                "https://raw.githubusercontent.com/abuzucom/agents-personas/"
                "1649e5c9710fd85d6cca12006e344af27a5404a6/reviewers/foucault/AUDIT.md",
            )
            self.assertEqual(retries, 3)
            self.assertEqual(backoff, 1.0)
            self.assertEqual(timeout, 30.0)

        custom_env = {
            "PERSONAS_QUALITY_REF": "v2.0",
            "PERSONAS_AUDIT_REF": "v3.0",
            "POLICY_DRIFT_RETRIES": "5",
            "POLICY_DRIFT_BACKOFF_SECONDS": "2.5",
            "POLICY_DRIFT_TIMEOUT_SECONDS": "45.0",
        }
        with patch.dict("os.environ", custom_env, clear=True):
            quality_url, audit_url, retries, backoff, timeout = get_policy_config()
            self.assertEqual(
                quality_url,
                "https://raw.githubusercontent.com/abuzucom/agents-personas/v2.0/reviewers/euler/QUALITY.md",
            )
            self.assertEqual(
                audit_url,
                "https://raw.githubusercontent.com/abuzucom/agents-personas/v3.0/reviewers/foucault/AUDIT.md",
            )
            self.assertEqual(retries, 5)
            self.assertEqual(backoff, 2.5)
            self.assertEqual(timeout, 45.0)

    def test_get_policy_config_rejects_retired_environment_names(self) -> None:
        from scripts.check_policy_drift import get_policy_config
        retired_env = {
            "EULER_POLICY_URL": "https://raw.githubusercontent.com/abuzucom/euler/main/QUALITY.md",
            "FOUCAULT_POLICY_URL": "https://raw.githubusercontent.com/abuzucom/foucault/main/AUDIT.md",
        }
        with patch.dict("os.environ", retired_env, clear=True):
            with self.assertRaises(ValueError):
                get_policy_config()

    def test_parse_int_env(self) -> None:
        from scripts.check_policy_drift import parse_int_env
        with patch.dict("os.environ", {"TEST_INT": "5"}):
            self.assertEqual(parse_int_env("TEST_INT", 3, 1, 10), 5)
        with patch.dict("os.environ", {"TEST_INT": "20"}):
            with self.assertRaises(ValueError):
                parse_int_env("TEST_INT", 3, 1, 10)
        with patch.dict("os.environ", {"TEST_INT": "invalid"}):
            with self.assertRaises(ValueError):
                parse_int_env("TEST_INT", 3, 1, 10)
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(parse_int_env("TEST_INT", 3, 1, 10), 3)

    def test_parse_float_env(self) -> None:
        from scripts.check_policy_drift import parse_float_env
        with patch.dict("os.environ", {"TEST_FLOAT": "2.5"}):
            self.assertEqual(parse_float_env("TEST_FLOAT", 1.0, 0.0, 60.0), 2.5)
        with patch.dict("os.environ", {"TEST_FLOAT": "100.0"}):
            with self.assertRaises(ValueError):
                parse_float_env("TEST_FLOAT", 1.0, 0.0, 60.0)
        with patch.dict("os.environ", {"TEST_FLOAT": "invalid"}):
            with self.assertRaises(ValueError):
                parse_float_env("TEST_FLOAT", 1.0, 0.0, 60.0)
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(parse_float_env("TEST_FLOAT", 1.0, 0.0, 60.0), 1.0)


if __name__ == "__main__":
    unittest.main()
