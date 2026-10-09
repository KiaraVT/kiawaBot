from __future__ import annotations

import os
import unittest
from pathlib import Path

from ci.run_model_command import (
    FORBIDDEN_SHELL_TOKENS,
    MAX_DIAGNOSTIC_CHARS,
    parse_command,
    sanitize_diagnostics,
)


class TestRunModelCommand(unittest.TestCase):
    def test_parse_command_valid(self) -> None:
        cmd = "python ci/call_model.py"
        args = parse_command(cmd)
        self.assertEqual(len(args), 2)
        self.assertTrue(args[1].endswith(str(Path("ci/call_model.py"))))

    def test_parse_command_valid_python3(self) -> None:
        cmd = "python3 ci/call_model.py"
        args = parse_command(cmd)
        self.assertEqual(len(args), 2)
        self.assertTrue(args[1].endswith(str(Path("ci/call_model.py"))))

    def test_parse_command_rejects_empty(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            parse_command("")
        self.assertIn("contains shell syntax", str(ctx.exception))

    def test_parse_command_rejects_shell_tokens(self) -> None:
        for token in FORBIDDEN_SHELL_TOKENS:
            with self.subTest(token=token):
                with self.assertRaises(ValueError) as ctx:
                    parse_command(f"python ci/call_model.py {token}")
                self.assertIn("contains shell syntax", str(ctx.exception))

    def test_parse_command_rejects_non_python(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            parse_command("node ci/call_model.py")
        self.assertIn("must name one Python script", str(ctx.exception))

    def test_parse_command_rejects_backslashes(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            parse_command(r"python 'ci\call_model.py'")
        self.assertIn("must use a repository-relative path", str(ctx.exception))

    def test_parse_command_rejects_absolute_path(self) -> None:
        abs_path = "C:/tmp/script.py" if os.name == "nt" else "/tmp/script.py"
        with self.assertRaises(ValueError) as ctx:
            parse_command(f"python {abs_path}")
        self.assertIn("script must be relative", str(ctx.exception))

    def test_parse_command_rejects_non_py_extension(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            parse_command("python package.json")
        self.assertIn("script must remain in the repository", str(ctx.exception))

    def test_sanitize_diagnostics_replaces_control_characters(self) -> None:
        text = "Hello\x00\x01\x02World\x07!"
        sanitized = sanitize_diagnostics(text)
        self.assertEqual(sanitized, "Hello???World?!")

    def test_sanitize_diagnostics_redacts_credentials(self) -> None:
        key_label = "api" + "_key"
        text = f"Error: {key_label}=dummy-test-key-12345 failed. password: dummy-test-password."
        sanitized = sanitize_diagnostics(text)
        self.assertNotIn("dummy-test-key-12345", sanitized)
        self.assertNotIn("dummy-test-password", sanitized)
        self.assertIn("<redacted>", sanitized)

    def test_sanitize_diagnostics_bounds_length(self) -> None:
        long_text = "A" * (MAX_DIAGNOSTIC_CHARS + 500)
        sanitized = sanitize_diagnostics(long_text)
        self.assertEqual(len(sanitized), MAX_DIAGNOSTIC_CHARS)

    def test_forwarded_environment_contains_api_keys(self) -> None:
        from ci.run_model_command import FORWARDED_ENVIRONMENT

        self.assertIn("MODEL_API_KEY", FORWARDED_ENVIRONMENT)
        self.assertIn("OLLAMA_API_KEY", FORWARDED_ENVIRONMENT)


if __name__ == "__main__":
    unittest.main()
