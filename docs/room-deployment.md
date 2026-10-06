# Shared caption rooms

Implemented 2026-09-30. The mobile room app is separate from the original Python/Nemotron spike. Voice profiles are deferred.

## Deployed services

- Frontend: https://chatex.tsilva.eu (Vercel project `tsilvas-projects/chatex`; fallback alias https://chatex-phi.vercel.app).
- Backend: https://chatex-rooms.eng-tiago-silva.workers.dev (Cloudflare Worker `chatex-rooms`).
- One SQLite-backed Durable Object per room; a second object coordinates the daily creation quota.
- OpenAI `gpt-live-transcribe`, with low delay and a European Portuguese context hint. No language restriction is sent, preserving multilingual/code-switching input.
- API keys are server secrets. Participants need no provider accounts, subscriptions, or credentials.

## Behavior

The landing page requires a name before enabling room creation. Creating opens the waiting room directly. Other phones scan its QR invitation to open that room’s lobby, where they only enter their name to join. There is no manual room-code entry, and QR displays do not show a code underneath. Invitation links open the same lobby name prompt. That name is reused for the participant’s captions, with no second naming screen. Microphone access is requested automatically when creating or joining, without blocking entry while permission is pending; if unavailable, participants can still read and type. The in-room microphone button can mute or retry capture. The host starts when two participants are connected. Already live rooms admit new joiners directly, up to six members. Each speaking phone gets a separate transcription session; every participant receives normalized caption upserts. Unfinished captions stay in a live area; completed captions move to the history. Typed responses use the same named timeline.

Audio uses mono PCM16 at 24 kHz in 200 ms batches through AudioWorklet. Sequence numbers detect gaps; slow connections stop capture rather than accumulating stale audio. The provider relay commits on silence or at an eight-second turn boundary, and flushes the current turn when muted. Browser echo cancellation and noise suppression are requested.

Reconnects restore membership and a bounded caption snapshot. Audio is never replayed. Short connection drops can restart an existing capture; reloading the page requires explicit microphone activation again. Capture stops when leaving or ending the room. A screen wake lock is requested when supported; the page must remain visible for this trial.

Provider connection failures automatically retry twice, after 500 ms and one second, retaining the existing microphone capture. Audio during the outage is dropped. Muting, leaving, or ending cancels pending retries. After the retry budget is exhausted, the microphone stops and the user can retry manually; ten seconds of accepted audio restores the automatic retry budget.

Ending or expiring a room deletes its Durable Object storage, closes provider/client sockets, and clears captions on connected phones. No audio is stored. Worker observability is disabled to avoid recording requests or caption payloads in application logs. Closed/offline browsers clear stale captions when they reconnect to an ended room.

## Trial limits

- Six participants per room (including disconnected memberships reserved until leave/end).
- Room expires one hour after creation, including waiting time.
- Ten rooms per UTC day across this deployment.
- HTTP/upgrade requests: 20 per minute per connecting IP.
- WebSocket control/audio message and byte limits; at most 200 caption cards retained for reconnect.
- These are private-trial bounds, not a complete public-service abuse or billing system.

The frontend origin is explicitly allowed by the backend. Production Vercel aliases must be added to `ALLOWED_ORIGINS`; preview deployments are not authorized automatically. Room tokens are sent as WebSocket subprotocol credentials, not query strings. Host credentials are separate from public invitations. Browser membership tokens live in session storage, never in the invitation.

## Commands

Dependencies use pinned pnpm versions with a seven-day release-age cutoff and exotic dependency blocking. Only esbuild/workerd install scripts are allowed.

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler types --config worker/wrangler.jsonc --strict-vars false worker/worker-configuration.d.ts
pnpm typecheck
CHATEX_API_URL=https://chatex-rooms.eng-tiago-silva.workers.dev pnpm build
pnpm exec wrangler deploy --config worker/wrangler.jsonc --dry-run
pnpm deploy:backend
vercel deploy --prod --yes --scope tsilvas-projects
```

`CHATEX_API_URL` is set in the Vercel project's production environment. `pnpm secrets:sync:production` copies only `OPENAI_API_KEY` from Infisical `chatex-production`, Production `/`, to the pinned existing Worker through private stdin. It verifies secret metadata; Cloudflare cannot reveal the value for exact readback. `scripts/set-openai-secret.py` delegates to this managed command. Secret values are never copied into the static build or Wrangler config.

For local work, follow [Local development](#local-development). Optional `TRANSCRIPTION_URL` and `TRANSCRIPTION_TOKEN` in Infisical Development configure a compatible service. The default launcher bypasses legacy `worker/.dev.vars`.

## Local development

Run these commands from the repository root after `pnpm install --frozen-lockfile`. Use Node.js 22 or newer and pnpm 10.33.0. Wrangler uses numeric `--port 0` to choose a free port; the frontend server also chooses its port automatically. Keep existing servers running and reuse their printed URLs.

For connected local development, run `infisical login --domain https://app.infisical.com` and store `OPENAI_API_KEY` in Infisical `chatex`, Development `/`. Root `.infisical.json` pins the project; default dotenv files are bypassed. A real transcription session incurs OpenAI charges; `pnpm test:rooms` uses a mock provider and needs no real key.

```sh
infisical login --domain https://app.infisical.com
```

In the first terminal, build and serve the frontend:

```sh
pnpm build
node scripts/serve.mjs --port auto
```

In a second terminal, paste the exact frontend URL when prompted, then start the local backend. The origin override applies only to this local process:

```sh
printf 'Frontend URL printed by the server: '
read -r chatex_frontend_url
pnpm dev --port auto --origin "$chatex_frontend_url"
```

In a third terminal, rebuild using the backend URL printed by Wrangler:

```sh
printf 'Backend URL printed by Wrangler: '
read -r chatex_api_url
CHATEX_API_URL="$chatex_api_url" pnpm build
```

Open or reload the frontend URL from the first terminal. The static server reads the rebuilt files without a restart. A phone opening this development server needs a reachable HTTPS setup for microphone access; use the deployed site for the multi-phone trial.

## Provider boundary

`worker/src/transcription.ts` accepts PCM24 and emits `{item, text, final, time}`. OpenAI is implemented and verified separately from mock tests. `TRANSCRIPTION_PROVIDER=compatible` supports a configured server that implements the same session/update/append/commit and transcription-event protocol. Other providers require their own adapter; this does not claim arbitrary APIs are compatible. A model on beast-3 can expose that protocol behind an authenticated HTTPS endpoint, without changing frontend/room code.

## Verification and remaining trial

`tests/rooms/room.test.mjs` exercises the real local Workers runtime using `tests/rooms/mock-provider.mjs`: six members, two concurrent streams, named final captions, guest permissions, capacity, typed-message idempotence, reconnect snapshots, no token disclosure, and end/delete behavior. `pnpm test:rooms` launches isolated local backend and mock provider servers on automatically assigned ports, runs all tests, and cleans up its own servers. It never uses the real OpenAI key. To test an already running local backend, run `node --test tests/rooms/*.test.mjs` with `CHATEX_TEST_API` and `CHATEX_TEST_ORIGIN` set.

`node scripts/check-live.mjs <Portuguese PCM24> <English PCM24>` tests two synthesized streams concurrently through the deployed Worker and real OpenAI API, then ends the room. Configure `CHATEX_API_URL` and `CHATEX_FRONTEND_URL`. The sanitized report is saved in `docs/live-room-check.json`. The native Codex browser also checks create/join/start, shared typed captions, ending both screens, and mobile layout.

A multi-phone microphone trial in a real Portuguese conversation remains necessary. Participant names identify source phones; cross-talk, music, nearby speech, and overlaps can cause misattribution. No voice filtering or single-phone diarization is implemented in this version.
