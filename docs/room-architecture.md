# Architecture proposal: shared live captions

Date: 2026-09-30. This is a proposed design, not an implementation or approved product specification. The original Python/GPU spike was retired on 2026-10-06. GPU components described below are historical proposals, not active setup instructions. The current implementation and deployment are described in [room-deployment.md](room-deployment.md).

Scope update (2026-09-30): the user deferred voice profiles until a later version. The current design has no enrollment, cached voice samples, or profile-based filtering; joiners enter a name and choose microphone participation. Each named phone supplies its own transcription stream. The voice-profile sections below are retained as a future proposal. Source-phone labels alone do not resolve cross-talk or establish crowded-bar accuracy.

## Confirmed direction

Mobile webpage; cached voice profile; room creation and joining through QR invitations; separate participant audio streams to a server; live named captions shared with every participant; European Portuguese and multilingual support; usable conversation-following UX. The user accepts multiple phones while preferring a single phone when feasible.

## Decisions pending

- Personal private trial versus a public product and larger rooms.
- Whether keeping the page visible and screen awake is acceptable.
- Whether captions disappear after the room ends or are retained.
- Guest names and voice samples versus immediate joining or accounts with cross-device profiles.

Recommendations below assume a small private trial with guest participants and foreground phones. These remain recommendations until answered.

## Components and deployment

Use one HTTPS origin for the mobile frontend and a Python FastAPI server, retaining useful portions of the current audio transport and OpenAI adapter. A single process can coordinate rooms, membership, caption events, reconnects, and session limits. For the first small trial, room state and a bounded caption replay log can remain in memory; server restart ends active rooms. Add a database only if persistent histories, accounts, or restart survival become requirements.

Keep the frontend framework small; the existing plain HTML/JavaScript can be reorganized into modules. Capture microphone frames through an AudioWorklet and stream binary mono PCM in short batches over a secure WebSocket. A 24 kHz, 16-bit mono stream uses approximately 48 kB/s before protocol overhead. This is a simplicity choice for the prototype. Measure cellular bandwidth and battery use; consider compressed WebRTC transport once those measurements justify the extra media infrastructure.

The server opens one transcription session per actively capturing participant. API credentials stay on the server. A participant who only wants to read or type can join without microphone permission or voice enrollment. Audio is not broadcast to other phones, and the page does not play the room's audio aloud.

Run voice processing as a separate warm GPU worker on beast-3 during development. Load the model once and maintain separate per-participant state. The coordinator must remain responsive if the worker becomes slow or unavailable. Use bounded audio queues, mark gaps explicitly, and stop forwarding stale audio rather than letting latency grow indefinitely. A public HTTPS endpoint accessible on cellular networks is required for bar use; the current localhost SSH tunnel is only a development connection. Production location and provider are undecided.

## Voice profile lifecycle

On first use, the person enters a display name and records a short, clean sample. The required sample length depends on the selected voice model; a roughly 15-second onboarding exercise is a UX starting point to test. Check for enough speech, clipping, and interference; offer re-recording when unsuitable.

Cache the reference and any model-specific representation in IndexedDB under this site's origin, along with a profile ID, schema/model version, and display name. A model that requires enrollment audio must not be assumed to work from an embedding alone. Upload only the material required for the current room's processing; retain it in server memory for the session under the recommended guest design. Clear it when the participant leaves or the room expires. A visible delete/re-record control removes the local profile. Browser storage can be cleared, and changing phone or browser requires re-enrollment under this design. Cross-device reuse requires a different persistence decision.

A voice profile is a model hint, not authentication. Display names, room permission, reconnect identity, and speaker verification are separate concerns.

## Room and audio flow

1. The host creates a room and sees an invitation QR code plus a shareable link. The QR encodes an HTTPS invitation URL, not an audio connection or biometric profile.
2. A joiner opens the link, confirms their cached name/profile or enrolls, and chooses microphone participation or read/type participation. Joining never silently starts the microphone.
3. The server issues a membership credential tied to room and participant. Host controls use a separate credential. Invitations can expire or be rotated, and participants can be removed.
4. Each microphone stream carries sequence numbers and sample counts on an authenticated connection. The server maps client audio clocks onto a room timeline; independent OpenAI arrival order and unsynchronized phone wall clocks cannot define conversation order.
5. The voice worker uses the participant's reference to identify owner speech and, when available and validated, extract the owner's audio. Transcribe owner-focused audio through the OpenAI adapter.
6. Normalize ASR events into caption upserts identified by room ID, participant ID, stream epoch, turn ID, revision, text, start/end room times, and final status. Treat speaker verification status separately from ASR confidence, which the current live model does not expose.
7. Broadcast text events to all room members. Each browser updates the same caption in place rather than appending every transcript delta as a new message.
8. On reconnection, replay text events after the client's last server event ID, within the room's bounded log. Start a new audio epoch where needed; do not replay already acknowledged audio blindly and create duplicate captions.

## Voice processing boundary

The current OpenAI live model has no documented reference-based voice isolation input. Nemotron supplies anonymous speaker activity rather than an enrolled person's isolated speech. This design therefore needs a separate model evaluated for streaming target speaker extraction or owner-speech verification.

Verification can gate speech that is clearly from another person; it cannot separate overlapping people by itself. Target speaker extraction can process overlaps but may erase wanted words or leak another voice. Neither must silently be represented as guaranteed. Keep filtering behind an adapter and measure usable Portuguese words, name correctness, duplicate captions, false rejections, and incremental delay.

Cache reusable enrollment work; do not cache a prior room's streaming state as if it were a universal profile. Source-phone identity is only a candidate identity while cross-talk is unresolved. If verification or extraction fails, show an explicit degraded/unverified state or pause name-specific captions rather than silently attaching all captured speech to the phone owner. Whether to offer a user-controlled unfiltered mode should be decided during testing.

Cross-stream duplicate suppression is a secondary check. Do not remove captions solely because the text matches: two friends can repeat the same phrase. Use timing and acoustic evidence when justified. Do not compare raw phone amplitudes as though all devices had identical gain.

## Reader UX

Use a single conversation timeline with large text, participant names, and stable colors; color alone never carries identity. Place active unfinished captions in a stable live area. Multiple concurrent speakers occupy separate cards there. When finished, retain their chronological positions in the history; annotate overlap rather than continually sorting existing cards around as late ASR results arrive.

Partial captions update within their existing card and are visually distinct from finalized text. Limit distracting movement. Readers can scroll back without being pulled to the bottom; a clearly labeled return-to-live control restores following. Participant controls allow muting/hiding selected people or focusing on one friend.

Provide text entry for the deaf participant's responses, shared in the same conversation and clearly marked as typed. Include a quick request-to-repeat action. Show microphone, processing, and connection status clearly so silence is distinguishable from failure. Offer font-size and contrast controls. Validate automatic screen-reader announcements rather than announcing every word revision.

## Simplest proposed first version

One server; small private rooms; no accounts; one locally cached profile per browser; European Portuguese as the initial configured language, with an ASR adapter preserving later multilingual options; same captions for all members; live text and a bounded reconnect buffer; no persistent conversation recording; foreground phones; no custom hardware or single-phone speech separation in the first implementation.

There are two gates before calling this usable: first, multiple phones sharing captions with correct event/reconnect behavior; second, validated enrolled-speaker filtering and a real Portuguese noisy-conversation test. Completing the first gate alone must not be reported as solving the crowded-bar use case.

## Browser and API evidence

- [Microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) requires a secure context and user permission.
- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) provides an audio processing thread for low-latency work.
- [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) can keep a visible page awake but can be denied or released; it is not a guarantee of background microphone operation. Test iOS Safari and Android Chrome on the actual phones. If background capture is mandatory, reassess a native app after a device experiment.
- [OpenAI live transcription](https://developers.openai.com/api/docs/guides/realtime-transcription) provides incremental and finalized text, manual commit behavior, and no word timestamps, speaker labels, or confidence scores in the current live model.

No enrolled-voice filtering model, bar accuracy, latency, or mobile background behavior has been validated for this proposed application.
