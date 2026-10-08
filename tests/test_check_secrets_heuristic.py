from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_secrets_heuristic import (
    DEFAULT_GIT_TIMEOUT_SECONDS,
    DEFAULT_MAX_FILE_BYTES,
    MAX_FILE_BYTES,
    get_tracked_files,
    is_allowed,
    main,
    parse_max_bytes,
    scan_file,
)


class TestCheckSecretsHeuristic(unittest.TestCase):
    def test_clean_file_passes(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("console.log('hello world');\nconst port = 3000;\n")
            temp_path = Path(f.name)
        try:
            findings = scan_file(temp_path)
            self.assertEqual(findings, [])
        finally:
            temp_path.unlink()

    def test_private_key_detected(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n")
            temp_path = Path(f.name)
        try:
            findings = scan_file(temp_path)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0][1], "private_key")
        finally:
            temp_path.unlink()

    def test_aws_key_detected(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';\n")
            temp_path = Path(f.name)
        try:
            findings = scan_file(temp_path)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0][1], "aws_access_key")
        finally:
            temp_path.unlink()

    def test_generic_secret_with_backticks_detected(self) -> None:
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("const api_key = `abcdef0123456789`;\n")
            temp_path = Path(f.name)
        try:
            findings = scan_file(temp_path)
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0][1], "generic_secret_assignment")
        finally:
            temp_path.unlink()

    def test_allowlist_matching(self) -> None:
        self.assertTrue(is_allowed(Path(".env.example")))
        self.assertTrue(is_allowed(Path("tests/test_run_model_command.py")))
        self.assertFalse(is_allowed(Path("server.js")))

    def test_unreadable_file_reported(self) -> None:
        missing_path = Path("non_existent_file_xyz.txt")
        findings = scan_file(missing_path)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0][1], "unreadable_file")

    def test_oversized_file_skipped(self) -> None:
        from unittest.mock import MagicMock, patch
        mock_stat = MagicMock()
        mock_stat.st_size = MAX_FILE_BYTES + 1024
        with patch.object(Path, "stat", return_value=mock_stat):
            findings = scan_file(Path("some_large_file.bin"))
            self.assertEqual(findings, [])

    def test_main_clean_returns_zero(self) -> None:
        from unittest.mock import patch
        with patch("scripts.check_secrets_heuristic.get_tracked_files", return_value=[Path("clean.js")]):
            with patch("scripts.check_secrets_heuristic.scan_file", return_value=[]):
                self.assertEqual(main(), 0)

    def test_main_secret_detected_returns_one(self) -> None:
        from unittest.mock import patch
        secret_finding = [(10, "generic_secret_assignment", "token = 123")]
        with patch("scripts.check_secrets_heuristic.get_tracked_files", return_value=[Path("leak.js")]):
            with patch("scripts.check_secrets_heuristic.scan_file", return_value=secret_finding):
                self.assertEqual(main(), 1)

    def test_main_io_error_returns_two(self) -> None:
        from unittest.mock import patch
        io_finding = [(1, "unreadable_file", "Permission denied")]
        with patch("scripts.check_secrets_heuristic.get_tracked_files", return_value=[Path("unreadable.js")]):
            with patch("scripts.check_secrets_heuristic.scan_file", return_value=io_finding):
                self.assertEqual(main(), 2)

    def test_get_tracked_files_timeout(self) -> None:
        from unittest.mock import MagicMock, patch
        mock_result = MagicMock()
        mock_result.stdout = b"file1.js\x00file2.js\x00"
        with patch("subprocess.run", return_value=mock_result) as mock_run:
            files = get_tracked_files()
            self.assertEqual(files, [Path("file1.js"), Path("file2.js")])
            mock_run.assert_called_once()
            _, kwargs = mock_run.call_args
            self.assertEqual(kwargs.get("timeout"), DEFAULT_GIT_TIMEOUT_SECONDS)

    def test_parse_max_bytes(self) -> None:
        from unittest.mock import patch
        with patch.dict("os.environ", {"SECRETS_SCAN_MAX_BYTES": "2048"}):
            self.assertEqual(parse_max_bytes(), 2048)
        with patch.dict("os.environ", {"SECRETS_SCAN_MAX_BYTES": "invalid"}):
            self.assertEqual(parse_max_bytes(), DEFAULT_MAX_FILE_BYTES)
        with patch.dict("os.environ", {"SECRETS_SCAN_MAX_BYTES": "100"}):
            self.assertEqual(parse_max_bytes(), DEFAULT_MAX_FILE_BYTES)
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(parse_max_bytes(), DEFAULT_MAX_FILE_BYTES)


if __name__ == "__main__":
    unittest.main()
