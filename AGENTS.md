## Product Specifications

At the start of substantive repository work, use `$specs-author` to read the entire root `SPECS.md` once per ongoing task. Reuse unchanged contents across follow-ups and composed skills. Reread when the file or repository association changes, or new stakeholder intent requires a fresh comparison. Before finishing, always check for new or changed stakeholder intent; reread if the file or intent changed. Purely conversational follow-ups do not require another full read.

- Treat `SPECS.md` as the persistent source of stakeholder requirements that cannot be inferred reliably from code or remembered conversations.
- Apply the scope test to proposed and existing requirements: root `SPECS.md` contains only project-wide intent; scoped intent belongs in its nearest authoritative specification and must not be broadened to fit the root.
- If the task, repository, or user request contradicts, omits, or ambiguously interprets the specification, tell the user. Continue safe exploration and work that does not depend on resolving the issue, but never silently choose an interpretation.
- Never edit `SPECS.md` from inference. Propose the exact change, explain why it reflects stakeholder intent, and edit the file only after the user explicitly approves that exact change.
- Keep `SPECS.md` complete, concise, and compacted. It must contain stakeholder intent rather than implementation, architecture, operations, or transient project detail.

## Secrets

Local Worker development uses explicitly configured server environment values. Keep provider credentials out of the static
frontend. Production synchronization remains a separately authorized trusted
operation against its pinned existing Worker and Production source. Test it with
`pnpm test:production-sync`; never run the real synchronization for local checks.
Use `pnpm test:rooms` with its mock provider; do not start paid microphone or
transcription sessions for migration verification. Preserve existing dependency,
CI and license work.
