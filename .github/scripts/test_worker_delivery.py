"""Credential-free checks for Worker delivery CI authorization."""
import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location("worker_delivery", Path(__file__).with_name("worker_delivery.py"))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

class CompletedCIGateTests(unittest.TestCase):
    """Synthetic GitHub events exercise the production authorization boundary."""

    def setUp(self):
        import json
        import tempfile

        self.json = json
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.event_path = Path(self.temp.name) / "event.json"
        self.sha = "a" * 40
        self.repo = {"id": 123, "full_name": "tsilva/example"}
        self.config = {"repository": "tsilva/example", "githubRepositoryId": 123}
        self.run = {
            "id": 51, "workflow_id": 12, "run_number": 3, "run_attempt": 1,
            "path": ".github/workflows/ci.yml", "event": "push",
            "head_branch": "main", "head_sha": self.sha,
            "status": "completed", "conclusion": "success",
            "repository": self.repo.copy(), "head_repository": self.repo.copy(),
        }
        self.env = {
            "GITHUB_REPOSITORY": "tsilva/example", "GITHUB_REF": "refs/heads/main",
            "GITHUB_EVENT_NAME": "workflow_run", "GITHUB_SHA": self.sha,
            "GITHUB_WORKFLOW_REF": "tsilva/example/.github/workflows/production-delivery.yml@refs/heads/main",
            "GITHUB_EVENT_PATH": str(self.event_path), "GH_TOKEN": "fake-github",
        }
        self.write_event(self.run)

    def write_event(self, run, **changes):
        event = {"action": "completed", "repository": self.repo, "workflow_run": run}
        self.event_path.write_text(self.json.dumps(event | changes))

    def test_completed_main_ci_authorizes_its_exact_commit_without_sleeping(self):
        with (
            patch.dict(os.environ, self.env, clear=True),
            patch.object(d, "request", side_effect=[
                {"object": {"sha": self.sha}}, {"workflow_runs": [self.run]},
            ]) as request,
            patch.object(d.time, "sleep") as sleep,
        ):
            self.assertEqual(d.context(self.config), self.sha)
            d.verify_ci(self.config, self.sha)
        self.assertEqual(request.call_count, 2)
        sleep.assert_not_called()
        self.assertTrue(all(call.args[0] == "GET" for call in request.call_args_list))

    def test_manual_dispatch_requires_already_successful_ci_without_event_file(self):
        self.event_path.unlink()
        with (
            patch.dict(os.environ, self.env | {"GITHUB_EVENT_NAME": "workflow_dispatch"}, clear=True),
            patch.object(d, "request", return_value={"workflow_runs": [self.run]}),
            patch.object(d.time, "sleep") as sleep,
        ):
            d.verify_ci(self.config, self.sha)
        sleep.assert_not_called()

    def test_push_and_untrusted_events_are_rejected_before_network(self):
        for event in ("push", "pull_request", "pull_request_target", "repository_dispatch"):
            with (
                self.subTest(event=event),
                patch.dict(os.environ, self.env | {"GITHUB_EVENT_NAME": event}, clear=True),
                patch.object(d, "request") as request,
            ):
                with self.assertRaises(d.DeliveryError):
                    d.context(self.config)
                request.assert_not_called()

    def test_untrusted_or_unsuccessful_trigger_is_rejected_before_network(self):
        bad = [
            {"head_sha": "b" * 40}, {"head_branch": "feature"},
            {"event": "pull_request"}, {"event": "workflow_dispatch"},
            {"path": ".github/workflows/impostor.yml"},
            {"conclusion": "failure"}, {"conclusion": "cancelled"},
            {"conclusion": "skipped"}, {"conclusion": "neutral"},
            {"status": "in_progress"}, {"id": 0}, {"run_attempt": True},
            {"head_repository": self.repo | {"id": 456}},
            {"repository": self.repo | {"id": 456}},
            {"head_repository": self.repo | {"full_name": "attacker/example"}},
        ]
        for change in bad:
            self.write_event(self.run | change)
            with (
                self.subTest(change=change), patch.dict(os.environ, self.env, clear=True),
                patch.object(d, "request") as request,
            ):
                with self.assertRaises(d.DeliveryError):
                    d.context(self.config)
                request.assert_not_called()

    def test_invalid_event_envelope_is_rejected_before_network(self):
        for changes in ({"action": "requested"}, {"repository": self.repo | {"id": 456}}):
            self.write_event(self.run, **changes)
            with (
                self.subTest(changes=changes), patch.dict(os.environ, self.env, clear=True),
                patch.object(d, "request") as request,
            ):
                with self.assertRaises(d.DeliveryError):
                    d.context(self.config)
                request.assert_not_called()
        self.event_path.write_text("not-json")
        with patch.dict(os.environ, self.env, clear=True), patch.object(d, "request") as request:
            with self.assertRaises(d.DeliveryError):
                d.context(self.config)
            request.assert_not_called()

    def test_authoritative_ci_metadata_must_still_match_the_completed_event(self):
        for change in (
            {"id": 52}, {"workflow_id": 13}, {"run_attempt": 2}, {"run_number": 4},
            {"status": "in_progress"}, {"conclusion": "failure"},
            {"head_repository": self.repo | {"id": 456}},
            {"path": ".github/workflows/impostor.yml"},
        ):
            with (
                self.subTest(change=change), patch.dict(os.environ, self.env, clear=True),
                patch.object(d, "request", return_value={"workflow_runs": [self.run | change]}) as request,
                patch.object(d.time, "sleep") as sleep,
            ):
                with self.assertRaises(d.DeliveryError):
                    d.verify_ci(self.config, self.sha)
                request.assert_called_once()
                sleep.assert_not_called()

    def test_latest_pending_or_failed_run_blocks_an_older_success(self):
        for status, conclusion in (("queued", None), ("in_progress", None), ("completed", "failure")):
            latest = self.run | {"id": 52, "run_number": 4, "status": status, "conclusion": conclusion}
            with (
                self.subTest(status=status),
                patch.dict(os.environ, self.env | {"GITHUB_EVENT_NAME": "workflow_dispatch"}, clear=True),
                patch.object(d, "request", return_value={"workflow_runs": [self.run, latest]}),
                patch.object(d.time, "sleep") as sleep,
            ):
                with self.assertRaises(d.DeliveryError):
                    d.verify_ci(self.config, self.sha)
                sleep.assert_not_called()


    def test_main_advancing_after_ci_completion_holds_delivery(self):
        with (
            patch.dict(os.environ, self.env, clear=True),
            patch.object(d, "request", return_value={"object": {"sha": "b" * 40}}),
        ):
            with self.assertRaises(d.DeliveryError):
                d.context(self.config)
