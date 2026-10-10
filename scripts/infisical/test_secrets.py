"""Check local binding isolation, fixed destinations and private sync streams."""

import contextlib
import io
import json
import os
import unittest
from unittest.mock import patch
from common import Infisical, SecretError
from run import command, worker_environment
from sync_production import sync, PROJECT, worker_configuration


class SecretTests(unittest.TestCase):
    def test_fixed_project(self):
        self.assertEqual(Infisical().project, "ed3a9be4-94eb-4f23-b38b-dcaa972208e0")
        self.assertEqual(PROJECT, "b36d2fc6-cc3e-47f6-9264-857b204a97e9")

    def test_missing_key_does_not_use_legacy_process_value(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "stale"}):
            with self.assertRaises(SecretError):
                worker_environment({})

    def test_manager_credentials_removed_and_provider_allowlist(self):
        with patch.dict(
            os.environ, {"INFISICAL_TOKEN": "manager", "BWS_ACCESS_TOKEN": "manager"}
        ):
            e = worker_environment(
                {
                    "OPENAI_API_KEY": "dummy",
                    "INFISICAL_TOKEN": "malicious",
                    "PATH": "malicious",
                }
            )
        self.assertEqual(e["OPENAI_API_KEY"], "dummy")
        self.assertEqual(e["TRANSCRIPTION_TOKEN"], "")
        self.assertNotIn("INFISICAL_TOKEN", e)
        self.assertNotIn("BWS_ACCESS_TOKEN", e)
        self.assertNotEqual(e["PATH"], "malicious")

    def test_explicit_env_file_skips_default_dev_vars(self):
        args = command(["--port", "auto", "--origin", "http://127.0.0.1:51515"])
        self.assertIn("/dev/null", args)
        self.assertIn("ALLOWED_ORIGINS:http://127.0.0.1:51515", args)

    def test_destination_and_remote_overrides_rejected(self):
        for args in [
            ["--remote"],
            ["--origin", "https://external.invalid"],
            ["--origin", "http://localhost:1234/path"],
            ["--env", "prod"],
        ]:
            with self.assertRaises(SecretError):
                command(args)

    def test_worker_binding_allowlist(self):
        c = worker_configuration()
        self.assertEqual(
            c["secrets"]["required"], ["OPENAI_API_KEY"]
        )
        self.assertEqual(c["vars"]["TRANSCRIPTION_URL"], "")
        self.assertFalse(c["observability"]["enabled"])

    def test_reader_rejects_foreign_workspace(self):
        c = Infisical()
        row = {
            "key": "OPENAI_API_KEY",
            "value": "dummy",
            "workspace": PROJECT,
            "secretPath": "/",
            "type": "shared",
        }
        with patch.object(c, "command", return_value=json.dumps([row])):
            with self.assertRaises(SecretError):
                c.read()

    def test_reader_rejects_duplicate(self):
        c = Infisical()
        row = {
            "key": "OPENAI_API_KEY",
            "value": "dummy",
            "workspace": c.project,
            "secretPath": "/",
            "type": "shared",
        }
        with patch.object(c, "command", return_value=json.dumps([row, row])):
            with self.assertRaises(SecretError):
                c.read()

    def test_sync_secret_uses_private_stdin_and_keeps_other_secrets(self):
        rows = json.dumps(
            [
                {"name": "OPENAI_API_KEY", "type": "secret_text"},
                {"name": "OTHER", "type": "secret_text"},
            ]
        )
        with (
            patch("sync_production.Production") as p,
            patch("sync_production.wrangler", side_effect=[rows, "done", rows]) as w,
        ):
            p.return_value.read.return_value = {"OPENAI_API_KEY": "dummy-only"}
            with contextlib.redirect_stdout(io.StringIO()):
                sync()
        self.assertEqual(
            w.call_args_list[1].args,
            (["secret", "put", "OPENAI_API_KEY"], "dummy-only\n"),
        )

    def test_sync_does_not_create_unexpected_secret(self):
        with (
            patch("sync_production.Production") as p,
            patch("sync_production.wrangler", return_value="[]") as w,
        ):
            p.return_value.read.return_value = {"OPENAI_API_KEY": "dummy-only"}
            with self.assertRaises(SecretError):
                sync()
        self.assertEqual(w.call_count, 1)

    def test_sync_rejects_empty_key_before_provider_call(self):
        with (
            patch("sync_production.Production") as p,
            patch("sync_production.wrangler") as w,
        ):
            p.return_value.read.return_value = {}
            with self.assertRaises(SecretError):
                sync()
        w.assert_not_called()


if __name__ == "__main__":
    unittest.main()
