# Retired Python/Nemotron diarization experiment

The GPU workflow was removed from the active Chatex setup on 2026-10-06 at the user's request. The former server, browser page and tests remain in [the recovery archive](../archive/diarization-spike/README.md). Its reference manifest and lock install no third-party dependencies; the original environment is recoverable from the Git revision linked there. Historical setup and experiment results remain in Git history; they are not current run instructions.

Use [the shared-room deployment guide](room-deployment.md) for the supported local and production app. Both use OpenAI transcription with application keys managed through Infisical. No GPU host is required for this app.

Remote process shutdown and old credential cleanup on beast-3 require verified access to that host; removing the repository workflow does not establish that remote services have stopped.
