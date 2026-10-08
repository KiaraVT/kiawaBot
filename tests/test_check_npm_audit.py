from __future__ import annotations

import subprocess
import unittest
from unittest.mock import MagicMock, patch

from scripts.check_npm_audit import (
    DEFAULT_AUDIT_TIMEOUT_SECONDS,
    audit_dependencies,
    main,
    run_audit,
)


class TestCheckNpmAudit(unittest.TestCase):
    def test_audit_dependencies_clean(self) -> None:
        payload = {
            "vulnerabilities": {},
        }
        self.assertEqual(audit_dependencies(payload), 0)

    def test_audit_dependencies_grandfathered(self) -> None:
        payload = {
            "vulnerabilities": {
                "axios": {
                    "via": [
                        {
                            "url": "https://github.com/advisories/GHSA-xx6v-rp6x-q39c",
                            "title": "Prototype pollution",
                        }
                    ]
                },
            },
        }
        self.assertEqual(audit_dependencies(payload), 0)

    def test_audit_dependencies_new_unapproved_advisory(self) -> None:
        payload = {
            "vulnerabilities": {
                "untrusted-pkg": {
                    "via": [
                        {
                            "url": "https://github.com/advisories/GHSA-9999-9999-9999",
                            "title": "Remote code execution",
                        }
                    ]
                },
            },
        }
        self.assertEqual(audit_dependencies(payload), 1)

    def test_audit_dependencies_string_via_skipped(self) -> None:
        payload = {
            "vulnerabilities": {
                "express": {
                    "via": ["body-parser"],
                },
            },
        }
        self.assertEqual(audit_dependencies(payload), 0)

    def test_audit_dependencies_non_ghsa_advisory_fails(self) -> None:
        payload = {
            "vulnerabilities": {
                "cve-only-pkg": {
                    "via": [
                        {
                            "url": "https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2026-9999",
                            "title": "CVE Only Flaw",
                            "cve": "CVE-2026-9999",
                        }
                    ]
                },
            },
        }
        self.assertEqual(audit_dependencies(payload), 1)

    def test_audit_dependencies_non_dict_non_str_via_fails(self) -> None:
        payload = {
            "vulnerabilities": {
                "corrupt-pkg": {
                    "via": [12345],
                },
            },
        }
        self.assertEqual(audit_dependencies(payload), 1)

    def test_run_audit_success(self) -> None:
        mock_result = MagicMock()
        mock_result.stdout = '{"vulnerabilities": {}}'
        mock_result.stderr = ""
        mock_result.returncode = 0
        with patch("subprocess.run", return_value=mock_result) as mock_run:
            data = run_audit()
            self.assertEqual(data, {"vulnerabilities": {}})
            mock_run.assert_called_once()
            _, kwargs = mock_run.call_args
            self.assertEqual(kwargs.get("timeout"), DEFAULT_AUDIT_TIMEOUT_SECONDS)

    def test_run_audit_empty_stdout_raises(self) -> None:
        mock_result = MagicMock()
        mock_result.stdout = ""
        mock_result.stderr = "npm ERR! network failure"
        mock_result.returncode = 1
        with patch("subprocess.run", return_value=mock_result):
            with self.assertRaises(RuntimeError) as ctx:
                run_audit()
            self.assertIn("network failure", str(ctx.exception))

    def test_run_audit_error_payload_raises(self) -> None:
        mock_result = MagicMock()
        mock_result.stdout = '{"error": {"code": "EAUDIT", "summary": "Audit error"}}'
        mock_result.stderr = ""
        mock_result.returncode = 1
        with patch("subprocess.run", return_value=mock_result):
            with self.assertRaises(RuntimeError) as ctx:
                run_audit()
            self.assertIn("Audit error", str(ctx.exception))

    def test_run_audit_timeout_raises(self) -> None:
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["npm", "audit"], timeout=DEFAULT_AUDIT_TIMEOUT_SECONDS)):
            with self.assertRaises(subprocess.TimeoutExpired):
                run_audit()

    def test_main_handles_subprocess_error(self) -> None:
        with patch("scripts.check_npm_audit.run_audit", side_effect=subprocess.SubprocessError("Failed")):
            self.assertEqual(main(), 1)

    def test_main_handles_runtime_error(self) -> None:
        with patch("scripts.check_npm_audit.run_audit", side_effect=RuntimeError("npm failed")):
            self.assertEqual(main(), 1)


if __name__ == "__main__":
    unittest.main()
