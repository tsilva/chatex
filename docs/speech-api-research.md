# Live transcription and speaker attribution API research

Checked 2026-09-30. Scope: official API documentation for live captions in Portuguese from Portugal, including speaker attribution. This is a capability review, not a measured provider benchmark.

## Documented capabilities

| Candidate | Live transcription | Speaker attribution | Portuguese from Portugal | Implication |
| --- | --- | --- | --- | --- |
| OpenAI `gpt-live-transcribe` | Incoming audio with incremental transcript deltas; tunable delay | Explicitly no word timestamps, speaker labels, or confidence scores | Accepts expected-language hints; the reviewed guide does not publish a specific `pt-PT` accuracy guarantee | Fits named, separate microphone streams. Combining a mixed transcript with an independent diarizer requires additional alignment. |
| OpenAI `gpt-4o-transcribe-diarize` | Streams results while processing an uploaded recording; not the microphone Realtime session model | `diarized_json` provides speaker, segment start/end, and text | The reviewed pages do not provide a European Portuguese performance guarantee | Useful for recorded-audio comparison; repeated short uploads add buffering and speaker continuity work. |
| Azure Speech `ConversationTranscriber` | Live SDK transcription events | Speaker ID on transcribing/transcribed phrases; intermediate labels can be enabled | `pt-PT` is in the supported speech-to-text locale table | Candidate for an integrated live service. |
| Deepgram Nova-3 | WebSocket live transcription | Speaker ID on each transcript word, alongside word timings | Explicit `pt-PT`, as well as `pt-BR` and generic `pt` | Candidate with direct word-to-speaker association. |

OpenAI's live guide documents client-side speech endpoint detection and manual audio commits; `gpt-live-transcribe` does not support `server_vad` or `semantic_vad`. Its delay levels trade earlier text for more acoustic context and therefore potential accuracy. The exact milliseconds vary. The guide explicitly requires evaluation of representative microphones, accents, noise, and each target language. [OpenAI live transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription).

OpenAI's diarization model is only available through the Transcription API. The file guide distinguishes response streaming of a completed recording from ongoing microphone audio. Speaker segments are emitted when finalized. Audio over 30 seconds requires `chunking_strategy`; up to four known-speaker references of 2–10 seconds can attach names. These features do not establish stable identities across independently submitted live chunks. [Model page](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize), [File transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).

Azure's quickstart assigns generic `Guest-1`, `Guest-2`, etc. It permits another supported recognition locale instead of the default English. Set `SpeechServiceResponse_DiarizeIntermediateResults=true` for speaker IDs on intermediate recognition; early results can still be `Unknown`. [Azure real-time diarization quickstart](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-stt-diarization). The locale table lists Portuguese (Portugal) as `pt-PT`; language support varies by feature, so verify the chosen region and endpoint during integration. [Azure language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt).

Deepgram documents Nova-3 for streaming and includes `pt-PT`. Its multilingual mode covers ten languages including Portuguese. [Models and languages](https://developers.deepgram.com/docs/models-languages-overview). The September 24, 2026 release states that improved Portuguese `pt`, `pt-BR`, and `pt-PT` models are available for batch and streaming without changing requests. This is the vendor's release claim, not independent evidence of bar performance. [September 24 release](https://developers.deepgram.com/changelog/2026/9/24).

Current Deepgram docs accept `diarize_model=v1` or `latest` for streaming, with `latest` resolving to streaming v1; v2 is batch only. The deprecated `diarize=true` remains a streaming v1 route. Live results contain word-level speaker IDs but no `speaker_confidence`. [Diarization guide](https://developers.deepgram.com/docs/diarization), [Live API reference](https://developers.deepgram.com/reference/speech-to-text/listen-streaming). A [May 2026 changelog](https://developers.deepgram.com/changelog/2026/5/13) previously said the new `diarize_model` parameter was batch only; the current API reference is more recent, so confirm the requested configuration with a small live integration test.

## What the documentation does not establish

None of these reviewed sources establishes that a phone on a table can reliably recover all friends' words while separating their voices from music, adjacent conversations, reverberation, and simultaneous speech in a crowded Portuguese bar. A diarization capability is not a guarantee of recovering the words of overlapping speakers.

There is no substantiated provider ranking here for European Portuguese in that setting, and no measured speech-to-caption latency from the user's phone/network. Live word speaker IDs avoid the current application's whole-turn attribution mismatch, but label accuracy, corrections, speaker continuity, and recognition quality still need tests.

## Evaluation decision

For one shared microphone, benchmark integrated Deepgram Nova-3 (`language=pt-PT`, streaming diarization) and Azure ConversationTranscriber (`pt-PT`, intermediate speaker IDs) against the existing OpenAI transcription baseline. Treat both as candidates until the same Portuguese recordings and live bar conditions have been measured.

For one microphone per known friend, OpenAI's current live model remains useful: the audio stream itself supplies the person's identity, removing the need to infer identity from a single mixture. This is an architectural inference; each microphone still needs acoustic rejection of nearby speakers and cross-stream duplication handling.

The acceptance test should report correctly understood conversation content, words attributed to the correct participant, missed/interfering speech, initial and stable caption latency, and readability for the intended deaf user. Include overlapping turns and similar voices; evaluate clean and crowded settings separately.
