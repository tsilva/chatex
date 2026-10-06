# Production secret delivery

Pushes to `main` and the **Production secret delivery** workflow's **Run workflow** button fetch the current production credential directly from Infisical using a short-lived GitHub OIDC identity. No Infisical login token or app credential is stored in GitHub. Changing a secret in Infisical alone does not trigger delivery: run this workflow on `main` after a rotation.

The GitHub `Production` environment accepts only `main`. OIDC trust is restricted to the exact workflow path, repository IDs and main branch. Credentials are available only to the provider step; checkout does not retain Git credentials. Fork/PR and superseded-commit runs cannot write. Runs are serialized. Provider responses, secret values and credential artifacts are not published.

Only `OPENAI_API_KEY` is delivered to the existing `chatex-rooms` Worker in the pinned Cloudflare account. The reader has access only to the isolated Chatex production vault. It waits for the existing CI on the exact main SHA to pass before publishing a new secret version, checks secret metadata and confirms OpenAI configuration through `/health`. The provider token is restricted to Workers Scripts Edit and Account Settings Read on the one account. Other bindings, Worker source and the static Vercel frontend are preserved. No paid transcription is used for this verification.

Watch the workflow result after pushes and rotations. A failed or canceled run requires review; provider writes are not blindly retried after an uncertain outcome. The existing local manual sync command remains available for recovery. Refresh the dedicated provider credential through the GitHub Production environment when it expires or is revoked.
