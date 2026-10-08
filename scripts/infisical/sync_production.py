"""Copy one pinned production build token through private CLI streams."""

import json
import subprocess
import sys
from common import Infisical, ROOT, SecretError, cli_environment

PROJECT = "b36d2fc6-cc3e-47f6-9264-857b204a97e9"
KEY = "OPENAI_API_KEY"


class Production(Infisical):
    def __init__(self):
        super().__init__(ROOT)
        self.project = PROJECT
        if self.domain != "https://app.infisical.com":
            raise SecretError("This production destination is pinned to the US cloud.")

    def command(self, args, value=None):
        command = [
            "infisical",
            *args,
            "--projectId",
            self.project,
            "--domain",
            self.domain,
            "--env",
            "prod",
            "--path",
            "/",
            "--silent",
            "--telemetry=false",
        ]
        result = subprocess.run(
            command,
            cwd=ROOT,
            env=cli_environment(),
            input=value,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode:
            raise SecretError("Production secret fetch failed; details suppressed.")
        return result.stdout


def worker_configuration():
    data = json.loads((ROOT / "worker/wrangler.jsonc").read_text())
    if (
        data.get("account_id") != "83e1ce4a70ea388693e8525a772ccefa"
        or data.get("name") != "chatex-rooms"
    ):
        raise SecretError("Worker account/name mismatch; no request.")
    return data


def wrangler(arguments, value=None):
    worker_configuration()
    env = cli_environment()
    for key in (
        "CLOUDFLARE_INCLUDE_PROCESS_ENV",
        "CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV",
    ):
        env.pop(key, None)
    r = subprocess.run(
        [
            "node",
            "node_modules/wrangler/bin/wrangler.js",
            *arguments,
            "--config",
            "worker/wrangler.jsonc",
            "--env-file",
            "/dev/null",
        ],
        cwd=ROOT,
        env=env,
        input=value,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if r.returncode:
        raise SecretError("Worker request failed; private provider details suppressed.")
    return r.stdout


def sync():
    value = Production().read().get(KEY)
    if not value or any(c in value for c in ("\0", "\n", "\r")):
        raise SecretError("Production key missing or invalid; no writes.")
    before = json.loads(wrangler(["secret", "list"]))
    if sum(x.get("name") == KEY for x in before) != 1:
        raise SecretError("Expected existing Worker secret not found; no writes.")
    wrangler(["secret", "put", KEY], value + "\n")
    after = json.loads(wrangler(["secret", "list"]))
    if sum(x.get("name") == KEY and x.get("type") == "secret_text" for x in after) != 1:
        raise SecretError("Worker metadata verification failed.")
    print(
        "OPENAI_API_KEY: synced to the pinned existing Chatex Worker; secret metadata verified. Cloudflare does not reveal secret values for readback."
    )


if __name__ == "__main__":
    try:
        if sys.argv[1:]:
            raise SecretError("No destination overrides are supported.")
        sync()
    except Exception as e:
        print(
            str(e)
            if isinstance(e, SecretError)
            else "Worker sync failed; private details suppressed.",
            file=sys.stderr,
        )
        sys.exit(1)
