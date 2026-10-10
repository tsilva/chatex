# Retired diarization experiment

Retired from the active Chatex workflow on 2026-10-06 at the user's request. This directory retains the earlier Python/Nemotron source and tests as historical reference. Current development and deployments use the OpenAI-backed Worker.

The server entry point rejects every launch before importing dependencies, loading models, or reading credentials. This includes Uvicorn and fake-model mode. The reference manifest has no dependencies, and its regenerated `uv.lock` contains only the virtual reference project. Installing this directory no longer installs the retired NeMo/Lightning environment.

The complete former dependency snapshot and source remain recoverable from [revision bdee072ed1b3](https://github.com/tsilva/chatex/tree/bdee072ed1b39890d38e05b27e3ffc672354515a/archive/diarization-spike). A trial upgrade to Lightning 2.6.6 broke both the pinned OneLogger checkpoint signature and NeMo's import of the removed NeptuneLogger. Keeping that unmaintained environment installable would retain a vulnerable checkpoint loader.

Restoration requires an explicit decision and a fresh compatible, audited dependency environment plus a credential and GPU review. Removing the launch guard alone is insufficient. Historical mocked model tests require such a restored environment; the dependency-free retirement checks remain runnable with `python3 tests/test_retirement.py` from this directory. The former experiment used an independent credential file on beast-3; retiring this dependency graph does not verify or change historical remote processes or credential files.
