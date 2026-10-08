from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_policy_drift import SEPARATOR, extract_embedded_policy


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


if __name__ == "__main__":
    unittest.main()
