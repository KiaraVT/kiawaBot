from __future__ import annotations

import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

from scripts.check_policy_drift import (
    APPROVED_POLICY_PATHS,
    DOCUMENTS,
    POLICY_MARKER_PREFIX,
    POLICY_MARKER_SUFFIX,
    SEPARATOR,
    PolicyDocument,
    extract_embedded_policy,
    fetch_text,
    get_policy_config,
    policy_file_url,
    validate_policy_base_url,
    validate_policy_ref,
    verify_policy,
)

PERSONAS_REF = "1649e5c9710fd85d6cca12006e344af27a5404a6"
BASE_URL = f"https://raw.githubusercontent.com/abuzucom/agents-personas/{PERSONAS_REF}"


def marker(path: str) -> str:
    """Return the policy marker line for one upstream path."""
    return f"{POLICY_MARKER_PREFIX}{path}{POLICY_MARKER_SUFFIX}"


def digest(text: str) -> str:
    """Return the SHA-256 digest of one policy text."""
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class TestCheckPolicyDrift(unittest.TestCase):
    def test_extract_embedded_policy(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(f"# Preamble\nSome text{SEPARATOR}{marker('reviewers/euler/QUALITY.md')}\nPolicy Content\nRules here\n")
            temp_path = Path(f.name)
        try:
            extracted = extract_embedded_policy(temp_path)
            self.assertEqual(extracted, {"reviewers/euler/QUALITY.md": "Policy Content\nRules here\n"})
        finally:
            temp_path.unlink()

    def test_extract_embedded_policy_returns_one_block_per_marker(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(
                f"# Preamble{SEPARATOR}{marker('reviewers/euler/QUALITY.md')}\nFirst\n{marker('reviewers/foucault/AUDIT.md')}\nSecond\n"
            )
            temp_path = Path(f.name)
        try:
            extracted = extract_embedded_policy(temp_path)
            self.assertEqual(
                extracted,
                {"reviewers/euler/QUALITY.md": "First\n", "reviewers/foucault/AUDIT.md": "Second\n"},
            )
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

    def test_extract_embedded_policy_missing_marker_raises(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as f:
            f.write(f"# Preamble{SEPARATOR}Policy without a marker\n")
            temp_path = Path(f.name)
        try:
            with self.assertRaises(ValueError):
                extract_embedded_policy(temp_path)
        finally:
            temp_path.unlink()

    def test_verify_policy_matching(self) -> None:
        policy_content = "Policy text\n"
        document = PolicyDocument(
            "doc.md",
            "Test Policy",
            ("reviewers/euler/QUALITY.md",),
            (digest(policy_content),),
        )
        with patch("scripts.check_policy_drift.fetch_text", return_value=policy_content):
            ok = verify_policy(
                document,
                {"reviewers/euler/QUALITY.md": policy_content},
                BASE_URL,
            )
            self.assertTrue(ok)

    def test_verify_policy_sha256_integrity_mismatch_fails(self) -> None:
        policy_content = "Policy text\n"
        document = PolicyDocument(
            "doc.md",
            "Test Policy",
            ("reviewers/euler/QUALITY.md",),
            ("0" * 64,),
        )
        with patch("scripts.check_policy_drift.fetch_text", return_value=policy_content):
            ok = verify_policy(
                document,
                {"reviewers/euler/QUALITY.md": policy_content},
                BASE_URL,
            )
            self.assertFalse(ok)

    def test_verify_policy_content_mismatch_fails(self) -> None:
        upstream_content = "Upstream text\n"
        document = PolicyDocument(
            "doc.md",
            "Test Policy",
            ("reviewers/euler/QUALITY.md",),
            (digest(upstream_content),),
        )
        with patch("scripts.check_policy_drift.fetch_text", return_value=upstream_content):
            ok = verify_policy(
                document,
                {"reviewers/euler/QUALITY.md": "Local text\n"},
                BASE_URL,
            )
            self.assertFalse(ok)

    def test_verify_policy_missing_embedded_block_fails(self) -> None:
        policy_content = "Policy text\n"
        document = PolicyDocument(
            "doc.md",
            "Test Policy",
            ("reviewers/euler/QUALITY.md",),
            (digest(policy_content),),
        )
        with patch("scripts.check_policy_drift.fetch_text", return_value=policy_content):
            ok = verify_policy(document, {}, BASE_URL)
            self.assertFalse(ok)

    def test_verify_policy_fetch_error(self) -> None:
        policy_content = "Policy text\n"
        document = PolicyDocument(
            "doc.md",
            "Test Policy",
            ("reviewers/euler/QUALITY.md",),
            (digest(policy_content),),
        )
        error = urllib.error.URLError("Network connection failed")
        with patch("scripts.check_policy_drift.fetch_text", side_effect=error):
            ok = verify_policy(
                document,
                {"reviewers/euler/QUALITY.md": policy_content},
                BASE_URL,
            )
            self.assertFalse(ok)

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
        self.assertEqual(validate_policy_ref("main", "agents-personas"), "main")
        self.assertEqual(validate_policy_ref("v1.0.0", "agents-personas"), "v1.0.0")
        with self.assertRaises(ValueError):
            validate_policy_ref("../traversal", "agents-personas")

    def test_validate_policy_base_url(self) -> None:
        valid_url = f"{BASE_URL}"
        self.assertEqual(validate_policy_base_url(valid_url, "agents-personas"), valid_url)
        with self.assertRaises(ValueError):
            validate_policy_base_url(
                "http://raw.githubusercontent.com/abuzucom/agents-personas/main",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_base_url(
                "https://attacker.com/abuzucom/agents-personas/main",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_base_url(
                "https://raw.githubusercontent.com/malicious/agents-personas/main",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_base_url(
                "https://raw.githubusercontent.com/abuzucom/", "agents-personas"
            )
        with self.assertRaises(ValueError):
            validate_policy_base_url(
                "https://raw.githubusercontent.com/abuzucom/agents-personas/main/../attacker",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_base_url(
                "https://raw.githubusercontent.com/abuzucom/agents-personas/main?ref=other",
                "agents-personas",
            )
        with self.assertRaises(ValueError):
            validate_policy_base_url(
                "https://user:pass@raw.githubusercontent.com/abuzucom/agents-personas/main",
                "agents-personas",
            )

    def test_policy_file_url_rejects_unapproved_paths(self) -> None:
        self.assertEqual(
            policy_file_url(BASE_URL, "reviewers/euler/QUALITY.md"),
            f"{BASE_URL}/reviewers/euler/QUALITY.md",
        )
        with self.assertRaises(ValueError):
            policy_file_url(BASE_URL, "reviewers/euler/other.md")
        with self.assertRaises(ValueError):
            policy_file_url(BASE_URL, "../../etc/passwd")

    def test_get_policy_config(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            base_url, ref, retries, backoff, timeout = get_policy_config()
            self.assertEqual(base_url, BASE_URL)
            self.assertEqual(ref, PERSONAS_REF)
            self.assertEqual(retries, 3)
            self.assertEqual(backoff, 1.0)
            self.assertEqual(timeout, 30.0)

        custom_env = {
            "PERSONAS_REF": "v2.0",
            "POLICY_DRIFT_RETRIES": "5",
            "POLICY_DRIFT_BACKOFF_SECONDS": "2.5",
            "POLICY_DRIFT_TIMEOUT_SECONDS": "45.0",
        }
        with patch.dict("os.environ", custom_env, clear=True):
            base_url, ref, retries, backoff, timeout = get_policy_config()
            self.assertEqual(
                base_url,
                "https://raw.githubusercontent.com/abuzucom/agents-personas/v2.0",
            )
            self.assertEqual(ref, "v2.0")
            self.assertEqual(retries, 5)
            self.assertEqual(backoff, 2.5)
            self.assertEqual(timeout, 45.0)

    def test_get_policy_config_accepts_a_base_url_override(self) -> None:
        custom_env = {"PERSONAS_BASE_URL": BASE_URL}
        with patch.dict("os.environ", custom_env, clear=True):
            base_url, _ref, _retries, _backoff, _timeout = get_policy_config()
            self.assertEqual(base_url, BASE_URL)

    def test_get_policy_config_rejects_retired_environment_names(self) -> None:
        retired_env = {
            "EULER_POLICY_URL": "https://raw.githubusercontent.com/abuzucom/euler/main/QUALITY.md",
            "FOUCAULT_POLICY_URL": "https://raw.githubusercontent.com/abuzucom/foucault/main/AUDIT.md",
        }
        with patch.dict("os.environ", retired_env, clear=True):
            with self.assertRaises(ValueError):
                get_policy_config()

    def test_every_policy_document_uses_approved_paths(self) -> None:
        for document in DOCUMENTS:
            for path in document.upstream_paths:
                self.assertIn(path, APPROVED_POLICY_PATHS)
            self.assertEqual(len(document.upstream_paths), len(document.digests))

    def test_local_policy_documents_embed_every_upstream_file(self) -> None:
        repo_root = Path(__file__).resolve().parent.parent
        for document in DOCUMENTS:
            doc_path = repo_root / document.doc_path
            self.assertTrue(doc_path.is_file(), f"{document.doc_path} must exist")
            blocks = extract_embedded_policy(doc_path)
            for path in document.upstream_paths:
                self.assertIn(path, blocks, f"{document.doc_path} must embed {path}")

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
