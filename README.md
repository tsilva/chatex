# Chatex

Live shared captions for conversations with friends. The mobile room app uses a Vercel frontend, Cloudflare room coordination, and a shared server-side OpenAI transcription account.

**Open the app:** https://chatex.tsilva.eu

Enter your name, create a room, and share its QR code or invitation link. Friends join with their own phones. The host starts the conversation; everyone sees named captions and can type replies. Voice profiles are deferred. Rooms support 2–6 people, expire after an hour, and delete captions when ended. Keep the page open during use.

See [deployment and verification](docs/room-deployment.md) for configuration, limits, provider adapters, tests, and the remaining real microphone trial.

## Original diarization spike

The files `app.py`, `index.html`, `openai_live.py`, and the Python environment remain the earlier standalone spike. They are not deployed as part of the room app.

# Live captions and speaker lanes

A single-user microphone spike that combines [NVIDIA Nemotron 3 Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization) with a choice of [OpenAI GPT Live Transcribe](https://developers.openai.com/api/docs/guides/realtime-transcription) or local [Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b). It shows live captions grouped by anonymous speaker alongside speaker activity lanes. European Portuguese (`pt-PT`) is the default; the menu also offers automatic language detection and other languages.

The browser sends 16 kHz mono PCM to beast-3 over a WebSocket. OpenAI mode resamples that audio to 24 kHz and sends it to the OpenAI API for live transcription; local mode runs Nemotron ASR on the GPU. Both modes run Nemotron diarization on beast-3 about every two seconds. OpenAI returns text without word timestamps or speaker labels, so its captions are matched approximately to speakers by phrase timing. Local ASR provides word timestamps. Speaker labels and recent text can change as more audio arrives. Diarization reprocesses the growing session, so its compute cost increases with session length. Sessions stop after 60 seconds. This is a research demo, not yet a reliable accessibility tool.

## Run on beast-3

Requirements: Linux, Python 3.12 or 3.13, an NVIDIA GPU with CUDA, `uv`, `ffmpeg`, and `libsndfile1`. The local models download on first start. Run from this directory:

```bash
ssh tsilva@beast-3.local 'mkdir -p ~/nemotron-diarization-spike'
rsync -av app.py asr_stream.py openai_live.py index.html pyproject.toml uv.lock README.md tsilva@beast-3.local:~/nemotron-diarization-spike/
ssh tsilva@beast-3.local
cd ~/nemotron-diarization-spike
```

To use OpenAI transcription, store an OpenAI API key outside the project on beast-3. The server also accepts `OPENAI_API_KEY` from its process environment. A local `.env` file is not loaded by the server. The key file is checked when a session starts, so adding it does not require a server restart; refresh the browser page after adding it. The file must be owned by the server user and inaccessible to group and other users. On beast-3:

```bash
install -d -m 700 ~/.config/nemotron-diarization-spike
umask 077
read -rs -p 'OpenAI API key: ' key; echo
printf '%s' "$key" > ~/.config/nemotron-diarization-spike/openai-api-key
unset key
```

Then install and start the server on beast-3:

```bash
sudo apt-get update && sudo apt-get install -y build-essential ffmpeg libsndfile1
uv sync --frozen --python 3.12
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 7860
```

On the local machine, create a tunnel:

```bash
ssh -N -L 7860:127.0.0.1:7860 tsilva@beast-3.local
```

Open <http://localhost:7860>. The localhost origin permits browser microphone access. Check <http://localhost:7860/health> first; `ready` is `true` when diarization and at least one transcription provider are available. Select a provider and language, click **Start microphone**, and speak. OpenAI mode sends microphone audio to OpenAI and incurs API charges. If two people take turns, separate speaker lanes should appear, and caption lines will receive approximate speaker labels after diarization catches up. If the OpenAI key is present at startup, local ASR is skipped to save GPU memory; set `LOAD_LOCAL_ASR=1` to load it too.

The lockfile pins NeMo Speech to NVIDIA's reference revision `5dbdde68d3897c03faeda1b0d9655cd90b1c5e08`; the user approved this Git dependency because the PyPI release predates the diarization model's high-resolution output support. Other direct dependencies resolve through PyPI. `--frozen` installs the recorded versions without refreshing the rolling seven-day package cutoff.

The GPU is shared with other services on beast-3. A Qwen image-generation service previously contributed to a local ASR out-of-memory failure. The local ASR wrapper explicitly collects timestamp hypotheses after each update; without that, GPU memory grew by roughly 200 MiB per update. OpenAI mode keeps ASR off the GPU when the key is present at startup.

## Scope and verification

The local dual-model WebSocket path has been tested on beast-3 with an RTX 4090 using synthesized European Portuguese and two different English voices. Those checks exercised local ASR, word timestamps, speaker turns, caption-to-speaker matching, and memory use across repeated and 55-second sessions. The OpenAI relay has mock WebSocket tests and was also tested against the live OpenAI API using synthesized European Portuguese followed by English from a second voice. The final captions matched both utterances, and Nemotron assigned them to separate speaker lanes; the first partial captions appeared about 2.6–2.8 seconds after audio started in these short tests. These checks do not establish real conversation accuracy or typical latency. The earlier diarization-only UI was checked with a live human microphone, but the combined OpenAI path still needs a human microphone trial. Recognition can be wrong or revise recent words, especially with overlapping speakers or unclear speech. The UI has no explicit language identification display in automatic mode.
