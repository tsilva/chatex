"""Unprivileged exact-commit/health checks for Chatex Worker code delivery."""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
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
        or required("GITHUB_EVENT_NAME") not in ("push", "workflow_dispatch")
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

def wait_for_ci(config, sha):
    url = (
        GITHUB
        + "/repos/"
        + config["repository"]
        + "/actions/workflows/ci.yml/runs?"
        + urllib.parse.urlencode(
            {"head_sha": sha, "branch": "main", "event": "push", "per_page": 10}
        )
    )
    deadline = time.monotonic() + 1500
    while time.monotonic() < deadline:
        runs = request("GET", url, required("GH_TOKEN"))["workflow_runs"]
        runs = sorted(
            [x for x in runs if x.get("head_sha") == sha],
            key=lambda x: x["run_number"],
            reverse=True,
        )
        if runs and runs[0]["status"] == "completed":
            if runs[0]["conclusion"] != "success":
                raise DeliveryError(
                    "This commit's CI failed; production delivery held."
                )
            return
        time.sleep(15)
    raise DeliveryError("CI did not finish in time; production delivery held.")
CONFIG={'repository': 'tsilva/chatex', 'githubRepositoryId': 1399606887, 'healthUrl': 'https://chatex-rooms.eng-tiago-silva.workers.dev/health'}

if __name__ == "__main__":
    try:
        sha=context(CONFIG)
        if sys.argv[1:]==["check"]:
            wait_for_ci(CONFIG,sha)
            context(CONFIG)
        elif sys.argv[1:]==["worker-health"]:
            verify_worker_health(CONFIG)
        else:
            raise DeliveryError("Unsupported unprivileged operation.")
    except Exception:
        raise SystemExit("Worker delivery check failed; private details suppressed.") from None
