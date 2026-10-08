from __future__ import annotations

import unittest

from scripts.check_npm_audit import audit_dependencies


class TestCheckNpmAudit(unittest.TestCase):
    def test_audit_dependencies_clean(self) -> None:
        payload = {
            "vulnerabilities": {},
            "metadata": {"vulnerabilities": {"total": 0}},
        }
        self.assertEqual(audit_dependencies(payload), 0)

    def test_audit_dependencies_grandfathered(self) -> None:
        payload = {
            "vulnerabilities": {
                "axios": {"severity": "high"},
                "express": {"severity": "moderate"},
            },
            "metadata": {"vulnerabilities": {"total": 2}},
        }
        self.assertEqual(audit_dependencies(payload), 0)

    def test_audit_dependencies_new_vulnerable_package(self) -> None:
        payload = {
            "vulnerabilities": {
                "untrusted-new-pkg": {"severity": "critical"},
            },
            "metadata": {"vulnerabilities": {"total": 1}},
        }
        self.assertEqual(audit_dependencies(payload), 1)

    def test_audit_dependencies_exceeds_threshold(self) -> None:
        payload = {
            "vulnerabilities": {
                "axios": {"severity": "high"},
            },
            "metadata": {"vulnerabilities": {"total": 99}},
        }
        self.assertEqual(audit_dependencies(payload), 1)


if __name__ == "__main__":
    unittest.main()
