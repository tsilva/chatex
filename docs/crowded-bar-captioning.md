# Captions for a conversation in a crowded bar

Date: 2026-09-30

## Goal and constraints

A deaf person in Portugal should be able to follow friends speaking naturally, including interruptions, with readable live captions and reliable names. European Portuguese and low caption delay are requirements. The user prefers a single phone but accepts multiple phones if they substantially improve the experience. Joining should be quick, ideally by QR code with no installation.

## Recommended direction

Prototype a shared caption room with one named audio stream per participant. Keep each microphone close to its owner's mouth; a phone lying among several people is still a mixed recording. A close external microphone can be tested later if holding phones is uncomfortable.

Each friend scans the room QR code, enters a name, permits microphone access, and keeps the page open during the first prototype. The server transcribes each stream independently and publishes partial and finalized captions to the reader's phone. Start with the OpenAI live transcription integration, since the user reports good transcription, and compare it with Deepgram Nova-3 using actual European Portuguese bar recordings before deciding on a provider. See [the speech API research](speech-api-research.md) for documented capabilities and limitations.

Device identity supplies a candidate name, not proof of who is speaking: every microphone can hear other friends. Cross-talk and duplicate captions must be measured. Prefer close microphone placement first; add cross-stream duplicate suppression and owner-voice verification only where evidence shows they are needed. Do not simply label every word heard on a friend's phone as that friend's speech, or compare raw microphone volume across devices as if their gains were identical.

The display should use stable names plus colors, a readable chronological conversation, immediate partial captions, and limited text revisions. When friends speak simultaneously, preserve both contributions where recognition succeeds. Show uncertainty or a lost connection visibly. Test readability and conversational participation with the intended user, not only recognition scores.

## Single phone mode

Retain a single phone as a convenience option to evaluate in quieter conditions. For this mode, use ASR that emits word timings and speaker labels together, rather than trying to attach entire untimed transcript turns to separately inferred speaker activity. Current documented candidates include Deepgram streaming diarization and Azure conversation transcription. A single mixed microphone still faces music, nearby strangers, reverberation, and overlapping speech; changing the API does not establish that it works in a crowded bar.

A dedicated microphone array with beamforming and speech separation is an alternative if a single capture device becomes mandatory. It adds hardware and engineering, and still needs validation on this exact setting. Do not purchase hardware or build a separation pipeline before the phone comparison identifies a concrete need.

## What the existing spike established

The 40-second ES2004a AMI excerpt was made from `Mix-Headset.wav`, a mixture of close headset recordings. Four model speaker lanes corresponded to the four annotated participants. This does not validate distant phone recording in bar noise. Only 3 of 9 finalized OpenAI caption turns were assigned a speaker by the current overlap heuristic. OpenAI live transcription supplies no word timestamps; a long turn may contain several speakers, so the current association can remain unassigned or be unreliable.

The spike was retired on 2026-10-06; its archived source is only a historical comparison baseline. The primary multi-phone architecture should not depend on the GPU diarizer or on aligning whole ASR turns to separate speaker intervals. Model count and benchmark diarization accuracy are not product acceptance criteria.

## Next experiment and decision gate

Run a consented session with three or four European Portuguese speakers. Capture a central phone and each participant's nearby phone at the same time, keeping channels separate. Begin in a quiet room, then use a real busy bar with interruptions and simultaneous speech. Include the intended caption reader in evaluating the experience.

Compare central-phone OpenAI (the baseline), central-phone streaming ASR with integrated speaker labels, and named individual-phone streams. Use annotated excerpts to measure words missed, words attached to the wrong person, duplicate captions, and caption delay measured from speech to visible text. Review overlapping speech separately. Include connection drops, phone handling, and sustained battery use in the practical test.

An initial product target is first readable text within about one second and stable phrases within about two seconds. These are proposed targets, not provider guarantees. Confirm tolerable delay, readability, and missed-turn rates with the user. Advance the least burdensome setup that lets the reader follow and respond to the real conversation reliably.

## Supporting primary sources

- [Ava advice for inaccurate captions](https://help.ava.me/en/articles/1215151-why-are-my-captions-not-working-accurate): multiple participant phones and microphone proximity; bars remain difficult.
- [Ava group conversations](https://help.ava.me/en/articles/2752252-captioning-group-conversations-on-ava): named group conversations with QR joining.
- [Ava language support](https://help.ava.me/en/articles/1215141-what-languages-and-countries-are-supported-by-ava): Portuguese is listed, without a separate documented European Portuguese accuracy claim.
- [Microsoft research on multiple personal-device microphones](https://www.microsoft.com/en-us/research/blog/bring-your-phones-to-the-conference-table-creating-ad-hoc-microphone-arrays-from-personal-devices/): benefit and alignment/device-processing challenges of multiple audio streams; this is meeting research, not proof of bar performance.
- [CHiME NOTSOFAR challenge](https://www.chimechallenge.org/challenges/chime8/task2/index): distant conversational speech and speaker attribution are evaluated jointly, with separate single-channel and microphone-array tracks.

These sources support investigating close and distributed capture. The recommended product architecture and experiment are engineering judgments; no bar accuracy or latency has been established for this application.
