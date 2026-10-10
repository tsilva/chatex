# Retired diarization experiment

Retired from the active Chatex workflow on 2026-10-06 at the user's request. This directory preserves the earlier Python/Nemotron code, dependency snapshot and tests for recovery; it is not maintained, installed, started or deployed by Chatex's current commands. The former root Python entry point and GPU setup instructions have been removed from the active setup.

As of 2026-10-10, the archived server entry point rejects every launch before importing dependencies, loading models, or reading credentials. This also blocks launching it through Uvicorn, including fake-model mode. The source, tests and dependency snapshot remain historical recovery material, as required by this repository's preservation instructions. Restoring it requires an explicit decision and a fresh dependency, credential and GPU review; removing the guard alone is insufficient. The historical experiment used an independent credential file on beast-3; archiving source does not verify or change that remote host's running processes or credential files.

The retained snapshot now overrides Hydra to 1.3.7 and fsspec to 2026.6.0.
These security updates preserve NeMo ASR imports and the archived mocked relay
tests. Lightning remains on NeMo's supported 2.4.0 line: its patched 2.6.6
release breaks the pinned OneLogger integration's checkpoint method signature.
The Lightning alert remains open because the preserved lock still contains the
historical dependency. The launch guard limits accidental use; it is not a
dependency patch or a dismissal of the alert. Recover the pre-guard server from
[revision fa84b462850d](https://github.com/tsilva/chatex/tree/fa84b462850d37f5b66de8a3e4ca39869fe22e62/archive/diarization-spike)
only as part of the restoration review described above.
