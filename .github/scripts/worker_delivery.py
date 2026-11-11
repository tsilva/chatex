"""Unprivileged exact-commit/health checks for Chatex Worker code delivery."""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
GITHUB="https://api.github.com"
class DeliveryError(Exception):
    """Only explicitly safe messages may reach the runner log."""

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DeliveryError("Provider redirect rejected.")

def request(method, url, token=None, payload=None):
    headers = {"Content-Type": "application/json", "User-Agent": "production-delivery"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect()).open(
            req, timeout=60
        ) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise DeliveryError(
            f"Provider request failed (HTTP {error.code}); response suppressed."
        ) from None
    except DeliveryError:
        raise
    except Exception:
        raise DeliveryError("Provider request failed; details suppressed.") from None

def required(name):
    value = os.environ.get(name, "")
    if not value or any(c in value for c in "\r\n\0"):
        raise DeliveryError(
            "Required workflow credential/configuration is missing or invalid."
        )
    return value

def context(config):
    if (
        required("GITHUB_REPOSITORY") != config["repository"]
        or required("GITHUB_REF") != "refs/heads/main"
        or required("GITHUB_EVENT_NAME") not in ("workflow_run", "workflow_dispatch")
        or required("GITHUB_WORKFLOW_REF")
        != config["repository"]
        + "/.github/workflows/production-delivery.yml@refs/heads/main"
    ):
        raise DeliveryError(
            "Workflow repository, branch, event or workflow path mismatch; no writes."
        )
    sha = required("GITHUB_SHA")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise DeliveryError("Invalid commit SHA; no writes.")
    triggering_ci_run(config, sha)
    latest = request(
        "GET",
        GITHUB + "/repos/" + config["repository"] + "/git/ref/heads/main",
        required("GH_TOKEN"),
    )
    if latest["object"]["sha"] != sha:
        raise DeliveryError("This run is superseded by a newer main commit; no writes.")
    return sha

def verify_worker_health(config):
    health = request("GET", config["healthUrl"])
    if health.get("provider") != "openai" or not health.get("configured"):
        raise DeliveryError(
            "Worker health does not confirm the configured OpenAI provider."
        )

def validate_ci_run(run, config, sha):
    """Accept only the approved repository's successful main-push CI."""
    try:
        for key in ("id", "workflow_id", "run_number", "run_attempt"):
            if type(run[key]) is not int or run[key] <= 0:
                raise ValueError()
        expected = {
            "path": ".github/workflows/ci.yml",
            "event": "push",
            "head_branch": "main",
            "head_sha": sha,
            "status": "completed",
            "conclusion": "success",
        }
        if any(run.get(key) != value for key, value in expected.items()):
            raise ValueError()
        for key in ("repository", "head_repository"):
            repo = run[key]
            if (
                type(repo["id"]) is not int
                or repo["id"] != config["githubRepositoryId"]
                or repo["full_name"] != config["repository"]
            ):
                raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise DeliveryError(
            "CI must be a successful main-push run of the approved ci.yml for this exact commit; no writes."
        ) from None

def triggering_ci_run(config, sha):
    # workflow_run's GITHUB_SHA is the default-branch tip, not necessarily the
    # triggering CI commit. Reject stale events instead of deploying that tip.
    if required("GITHUB_EVENT_NAME") != "workflow_run":
        return None
    try:
        event = json.loads(Path(required("GITHUB_EVENT_PATH")).read_text())
        repo = event["repository"]
        if (
            event["action"] != "completed"
            or type(repo["id"]) is not int
            or repo["id"] != config["githubRepositoryId"]
            or repo["full_name"] != config["repository"]
        ):
            raise ValueError()
        run = event["workflow_run"]
        validate_ci_run(run, config, sha)
        return run
    except (OSError, KeyError, TypeError, ValueError):
        raise DeliveryError("Invalid completed CI event; no credentials requested.") from None

def verify_ci(config, sha):
    """Recheck CI once; pending, failed or superseded CI never holds a runner."""
    trigger = triggering_ci_run(config, sha)
    url = (
        GITHUB
        + "/repos/"
        + config["repository"]
        + "/actions/workflows/ci.yml/runs?"
        + urllib.parse.urlencode(
            {"head_sha": sha, "branch": "main", "event": "push", "per_page": 10}
        )
    )
    try:
        runs = request("GET", url, required("GH_TOKEN"))["workflow_runs"]
        candidates = [run for run in runs if run.get("head_sha") == sha]
        if not candidates or any(
            type(run.get("run_number")) is not int for run in candidates
        ):
            raise ValueError()
        latest = max(candidates, key=lambda run: run["run_number"])
        validate_ci_run(latest, config, sha)
        if trigger and any(
            latest[key] != trigger[key]
            for key in ("id", "workflow_id", "run_attempt", "run_number")
        ):
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise DeliveryError(
            "The latest exact-commit CI run must already have succeeded; delivery held without waiting."
        ) from None
CONFIG={'repository': 'tsilva/chatex', 'githubRepositoryId': 1399606887, 'healthUrl': 'https://chatex-rooms.eng-tiago-silva.workers.dev/health'}

if __name__ == "__main__":
    try:
        sha=context(CONFIG)
        if sys.argv[1:]==["check"]:
            verify_ci(CONFIG,sha)
            context(CONFIG)
        elif sys.argv[1:]==["worker-health"]:
            verify_worker_health(CONFIG)
        else:
            raise DeliveryError("Unsupported unprivileged operation.")
    except Exception:
        raise SystemExit("Worker delivery check failed; private details suppressed.") from None
