# Retired diarization experiment

Retired from the active Chatex workflow on 2026-10-06 at the user's request. This directory preserves the earlier Python/Nemotron code, dependency snapshot and tests for recovery; it is not maintained, installed, started or deployed by Chatex's current commands. The former root Python entry point and GPU setup instructions have been removed from the active setup.

Do not launch this archive as part of local development or deployment. Restoring it requires an explicit decision and a fresh dependency, credential and GPU review. The historical experiment used an independent credential file on beast-3; archiving source does not verify or change that remote host's running processes or credential files.

The retained snapshot now overrides Hydra to 1.3.7 and fsspec to 2026.6.0.
These security updates preserve NeMo ASR imports and the archived mocked relay
tests. Lightning remains on NeMo's supported 2.4.0 line: its patched 2.6.6
release breaks the pinned OneLogger integration's checkpoint method signature.
The Lightning alert remains open, and this archive must still not be launched
without the restoration review described above.
