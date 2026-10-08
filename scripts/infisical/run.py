"""Inject only fixed Worker bindings using the saved human Infisical login."""

import os
import sys
from urllib.parse import urlparse
from common import ROOT, Infisical, SecretError, application_environment
from sync_production import worker_configuration


def command(arguments):
    args = [
        "node",
        "node_modules/wrangler/bin/wrangler.js",
        "dev",
        "--config",
        "worker/wrangler.jsonc",
        "--env-file",
        "/dev/null",
        "--port",
        "0",
        "--ip",
        "127.0.0.1",
        "--local",
    ]
    if arguments[:2] == ["--port", "auto"]:
        arguments = arguments[2:]
    if arguments:
        if len(arguments) != 2 or arguments[0] != "--origin":
            raise SecretError(
                "Only --port auto and --origin <loopback frontend URL> are supported."
            )
        u = urlparse(arguments[1])
        if (
            u.scheme != "http"
            or u.hostname not in ("127.0.0.1", "localhost")
            or u.username
            or u.password
            or u.path not in ("", "/")
            or u.query
            or u.fragment
        ):
            raise SecretError("Local frontend origin must be a loopback HTTP URL.")
        args += ["--var", "ALLOWED_ORIGINS:" + arguments[1].rstrip("/")]
    return args


def worker_environment(values):
    env = application_environment(values)
    if not env["OPENAI_API_KEY"]:
        raise SecretError(
            "OPENAI_API_KEY missing in the development project; no stale dotenv fallback."
        )
    # Wrangler ignores default .dev.vars for an explicit --env-file. With required
    # secret names, only those names and existing config vars become Worker bindings.
    env["CLOUDFLARE_INCLUDE_PROCESS_ENV"] = "true"
    env["CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV"] = "true"
    return env


def main():
    worker_configuration()
    args = command(sys.argv[1:])
    env = worker_environment(Infisical().read())
    os.chdir(ROOT)
    os.execvpe(args[0], args, env)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(
            str(e)
            if isinstance(e, SecretError)
            else "Local Worker launch failed; private details suppressed.",
            file=sys.stderr,
        )
        sys.exit(1)
