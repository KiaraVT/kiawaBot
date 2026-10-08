from __future__ import annotations

import unittest

from scripts.check_npm_audit import audit_dependencies


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


if __name__ == "__main__":
    unittest.main()
