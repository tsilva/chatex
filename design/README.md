# Chatex mobile design proposal

This is a standalone visual walkthrough, not the caption service. Open `index.html` to review five mobile screens, or serve this directory with a local static server. The overview shows all screens; the walkthrough controls switch between screens.

Confirmed constraints: 2–6 participants; foreground webpage; delete caption history when the room ends; one server-held OpenAI key shared by all participants. The proposed design uses guest names, with no account screens. Voice profiles are deferred until a later version. Account-free participation remains a recommended simplification rather than a separately confirmed requirement.

## Screens

1. Landing: create a room or join an invitation. QR invitations open the joining context directly; a code-entry fallback belongs to manual joining.
2. Join: room context, name, and either speaking participation or read/type participation. Explicit microphone activation belongs to joining, not merely scanning the invitation.
3. Waiting: invite QR/code, up to six people, participant readiness, guest waiting state, and host start state. Two participants are the proposed minimum to start. Participants can enter an already active room directly after joining; there is no approval queue in this proposed private-room UX.
4. Room: large named captions, stable active-speaker area, separate simultaneous contributions, historical transcript, text responses and a microphone toggle. Room actions and text-size controls are in one menu. Caption reading must not force scrolling. Expose a return-to-live control when a reader moves away from the latest messages; the static walkthrough does not implement an ASR-driven scrolling system.
5. Ended: clear deletion state and a way to return home. Host ending the room affects everyone; leaving as an ordinary participant is a separate menu action.

## State details for implementation

- Join by code: empty field, malformed/invalid code, connecting, full room, expired invite, room ended.
- Microphone: requesting permission, denied, unavailable, active, user-muted, browser-suspended.
- Waiting: joining, ready, host starts, host leaves, connection interrupted.
- Room: live, reconnecting, lost speech-processing service, scrollback, simultaneous speech, room ended.
- Each error should have a specific next action; microphone refusal offers read/type participation.
- Without voice profiles, participant labels identify the source phone. Nearby voices and cross-talk can still produce incorrect attribution; the prototype does not validate crowded-bar accuracy.

## Prototype boundary

The QR is illustrative and not scannable as a live invite. People, captions, room transitions and sharing are simulated. The prototype makes no API calls, creates no rooms, and captures no audio. It does not alter the running diarization spike.

The shared API key must stay on the server; it is not part of the client design. Per-room and per-participant limits should bound shared usage. Browser screens should not expose credentials or model settings.

Simplified after user feedback on 2026-09-30: removed slogans, sample conversations on the landing page, repeated explanations, decorative recording graphics, participant filters, the duplicate repeat action, and visible housekeeping controls. The landing has two actions; joining has a name and microphone switch; waiting has the QR and participant readiness; the room prioritizes captions. Host/guest preview controls sit outside the app screen.

Proposed visual system: warm neutral backgrounds, deep green primary actions, system sans-serif, 22–23 px caption text with larger-text control, and names plus stable colors. All copy is written for Portuguese from Portugal. The intended reader should evaluate legibility and simultaneous-speaker presentation before the implementation is finalized.
