"""Trusted Production metadata parsing and private CLI environment."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEYS = ("OPENAI_API_KEY", "TRANSCRIPTION_TOKEN", "TRANSCRIPTION_URL")
AUTH_KEYS = {
    "BWS_ACCESS_TOKEN",
    "INFISICAL_TOKEN",
    "INFISICAL_CLIENT_SECRET",
    "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET",
    "INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN",
}


class SecretError(Exception):
    """Only fixed, credential-free messages cross the CLI boundary."""


def cli_environment():
    # This workflow deliberately uses the human login saved by infisical login.
    return {
        key: value
        for key, value in os.environ.items()
        if key not in AUTH_KEYS and key not in KEYS and key != "INFISICAL_PROJECT_ID"
    }


class Infisical:
    """Strict source parser for the pinned trusted Production command."""

    def read(self):
        payload = self.command(
            [
                "export",
                "--format",
                "json",
                "--expand=false",
                "--include-imports=false",
                "--secret-overriding=false",
            ]
        )
        try:
            rows = json.loads(payload)
            if not isinstance(rows, list):
                raise ValueError()
            values = {}
            for row in rows:
                key, value = row["key"], row["value"]
                if (
                    not isinstance(key, str)
                    or not isinstance(value, str)
                    or row["workspace"] != self.project
                    or row["secretPath"] != "/"
                    or row["type"] != "shared"
                    or key in values
                ):
                    raise ValueError()
                values[key] = value
            return values
        except Exception:
            raise SecretError(
                "Unexpected Infisical response or duplicate secrets; raw output suppressed."
            ) from None
