## Product Specifications

Before every task in this repository, use the `$specs-author` skill to read the entire root `SPECS.md`. Before finishing, reread it and check the task and conversation for new or changed stakeholder intent.

- Treat `SPECS.md` as the persistent source of stakeholder requirements that cannot be inferred reliably from code or remembered conversations.
- Apply the scope test to proposed and existing requirements: root `SPECS.md` contains only project-wide intent; scoped intent belongs in its nearest authoritative specification and must not be broadened to fit the root.
- If the task, repository, or user request contradicts, omits, or ambiguously interprets the specification, tell the user. Continue safe exploration and work that does not depend on resolving the issue, but never silently choose an interpretation.
- Never edit `SPECS.md` from inference. Propose the exact change, explain why it reflects stakeholder intent, and edit the file only after the user explicitly approves that exact change.
- Keep `SPECS.md` complete, concise, and compacted. It must contain stakeholder intent rather than implementation, architecture, operations, or transient project detail.

## Secrets

Local Worker development fetches only the fixed Infisical development bindings. Default `.env` and `.dev.vars` are bypassed; required-secret configuration keeps manager credentials outside Worker bindings. Production OpenAI credentials live in `chatex-production`, Production `/`. `pnpm secrets:sync:production` updates only the existing OpenAI secret in the pinned Cloudflare account/Worker through private stdin, and verifies metadata. Keep keys outside the Vercel static frontend. Retain original local sources until verification. Use mocked room tests; do not start paid microphone/transcription sessions for migration checks. Preserve existing uv.lock, CI and license work.
