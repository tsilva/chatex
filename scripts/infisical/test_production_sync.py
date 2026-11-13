"""Verify pinned trusted Production synchronization with fake values only."""

import contextlib
import io
import json
import os
import unittest
from unittest.mock import patch
from common import SecretError, cli_environment
from sync_production import Production, sync, PROJECT, worker_configuration


class SecretTests(unittest.TestCase):
    def test_fixed_project(self):
        self.assertEqual(Production().project, 'b36d2fc6-cc3e-47f6-9264-857b204a97e9')
        self.assertEqual(Production().domain, "https://app.infisical.com")

    def test_trusted_cli_does_not_inherit_provider_or_manager_credentials(self):
        with patch.dict(os.environ, {"INFISICAL_TOKEN": "fake-manager", "BWS_ACCESS_TOKEN": "fake-manager", "OPENAI_API_KEY": "fake-provider"}):
            environment = cli_environment()
        for name in ("INFISICAL_TOKEN", "BWS_ACCESS_TOKEN", "OPENAI_API_KEY"):
            self.assertNotIn(name, environment)


    def test_worker_binding_allowlist(self):
        c = worker_configuration()
        self.assertEqual(
            c["secrets"]["required"], ["OPENAI_API_KEY"]
        )
        self.assertEqual(c["vars"]["TRANSCRIPTION_URL"], "")
        self.assertFalse(c["observability"]["enabled"])

    def test_reader_rejects_foreign_workspace(self):
        c = Production()
        row = {
            "key": "OPENAI_API_KEY",
            "value": "dummy",
            "workspace": "ed3a9be4-94eb-4f23-b38b-dcaa972208e0",
            "secretPath": "/",
            "type": "shared",
        }
        with patch.object(c, "command", return_value=json.dumps([row])):
            with self.assertRaises(SecretError):
                c.read()

    def test_reader_rejects_duplicate(self):
        c = Production()
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
