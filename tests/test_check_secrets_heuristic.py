from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_secrets_heuristic import is_allowed, scan_file


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

    def test_allowlist_matching(self) -> None:
        self.assertTrue(is_allowed(Path(".env.example")))
        self.assertFalse(is_allowed(Path("server.js")))

    def test_unreadable_file_reported(self) -> None:
        missing_path = Path("non_existent_file_xyz.txt")
        findings = scan_file(missing_path)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0][1], "unreadable_file")


if __name__ == "__main__":
    unittest.main()
