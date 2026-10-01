"""Single-user, live microphone diarization spike."""

import asyncio
import json
import logging
import os
import stat
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from asr_stream import ASR_MODEL_ID, SUPPORTED_LANGUAGES, WindowedASR, load_asr_model
from openai_live import MODEL_ID as OPENAI_ASR_MODEL_ID, OpenAILiveASR

SAMPLE_RATE = 16_000
MAX_SECONDS = 60
UPDATE_SECONDS = 2
ASR_UPDATE_SECONDS = 1
MODEL_ID = "nvidia/Nemotron-3-Diarization"
log = logging.getLogger("diarization")
model = None
model_error = None
asr_model = None
asr_error = None
model_lock = asyncio.Lock()
session_lock = asyncio.Lock()
OPENAI_KEY_FILE = Path.home() / ".config/nemotron-diarization-spike/openai-api-key"


def openai_api_key():
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key
    try:
        details = OPENAI_KEY_FILE.stat()
        if details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) & 0o077:
            return None
        return OPENAI_KEY_FILE.read_text().strip() or None
    except OSError:
        return None


def load_model():
    from nemo.collections.asr.models import SortformerEncLabelModel

    diarizer = SortformerEncLabelModel.from_pretrained(MODEL_ID)
    diarizer.eval()
    diarizer = diarizer.cuda()
    modules = diarizer.sortformer_modules
    # NVIDIA's 1.04 s input-buffer configuration (80 ms frame units).
    modules.spkcache_len = 264
    modules.fifo_len = 264
    modules.chunk_len = 9
    modules.chunk_right_context = 4
    modules.spkcache_update_period = 222
    diarizer._check_streaming_parameters()
    return diarizer


def parse_segments(raw):
    """Convert NeMo's 'start end speaker_id' lines to browser data."""
    segments = []
    for line in raw:
        parts = line.split()
        if len(parts) != 3:
            continue
        try:
            start, end = float(parts[0]), float(parts[1])
            speaker = int(parts[2].removeprefix("speaker_"))
        except ValueError:
            continue
        if 0 <= start < end and 0 <= speaker < 8:
            segments.append({"start": start, "end": end, "speaker": speaker})
    return segments


def infer(audio):
    # NeMo processes its low-latency chunks internally. Reprocessing the growing
    # session keeps this small spike simple, but computation grows with duration.
    import torch

    with torch.inference_mode():
        result = model.diarize(audio=audio, sample_rate=SAMPLE_RATE, batch_size=1, verbose=False)
    log_gpu(f"diarization {len(audio) / SAMPLE_RATE:.1f}s")
    return parse_segments(result[0])


def log_gpu(stage):
    if os.environ.get("GPU_MEMORY_DIAGNOSTICS") != "1":
        return
    import torch

    free, _ = torch.cuda.mem_get_info()
    log.warning(
        "GPU after %s: allocated=%d MiB reserved=%d MiB free=%d MiB",
        stage,
        torch.cuda.memory_allocated() // 2**20,
        torch.cuda.memory_reserved() // 2**20,
        free // 2**20,
    )


@asynccontextmanager
async def lifespan(_app):
    global model, model_error, asr_model, asr_error
    if os.environ.get("DIARIZATION_FAKE_MODEL") == "1":
        model_error = "Fake model mode is for UI checks only; no diarization inference is running."
        asr_error = "Fake model mode is for UI checks only; no transcription inference is running."
    else:
        try:
            model = await asyncio.to_thread(load_model)
            log.info("Loaded %s", MODEL_ID)
        except Exception as exc:
            model_error = f"Model failed to load: {exc}"
            log.exception("Model load failed")
        if os.environ.get("LOAD_LOCAL_ASR") == "1" or not openai_api_key():
            try:
                asr_model = await asyncio.to_thread(load_asr_model)
                log.info("Loaded %s", ASR_MODEL_ID)
            except Exception as exc:
                asr_error = f"ASR model failed to load: {exc}"
                log.exception("ASR model load failed")
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def index():
    return FileResponse(Path(__file__).with_name("index.html"))


@app.get("/health")
async def health():
    providers = {"openai": bool(openai_api_key()), "local": asr_model is not None}
    return {
        "ready": model is not None and any(providers.values()),
        "error": model_error or asr_error,
        "diarization_model": MODEL_ID,
        "asr_model": OPENAI_ASR_MODEL_ID if providers["openai"] else ASR_MODEL_ID,
        "providers": providers,
    }


@app.websocket("/stream")
async def stream(websocket: WebSocket):
    await websocket.accept()
    if model is None:
        await websocket.send_json({"type": "error", "message": model_error or asr_error or "Models not ready"})
        await websocket.close()
        return
    provider = websocket.query_params.get("provider", "local")
    if provider == "openai" and not openai_api_key():
        await websocket.send_json({"type": "error", "message": "OpenAI API key is not configured on beast-3."})
        await websocket.close()
        return
    if provider == "local" and asr_model is None:
        await websocket.send_json({"type": "error", "message": asr_error or "Local ASR is not loaded."})
        await websocket.close()
        return
    if provider not in {"local", "openai"}:
        await websocket.send_json({"type": "error", "message": f"Unknown transcription provider: {provider}"})
        await websocket.close()
        return
    language = websocket.query_params.get("language", "pt-PT")
    if language not in SUPPORTED_LANGUAGES:
        await websocket.send_json({"type": "error", "message": f"Unsupported language: {language}"})
        await websocket.close()
        return
    if session_lock.locked():
        await websocket.send_json({"type": "error", "message": "Another microphone session is active."})
        await websocket.close()
        return
    async with session_lock:
        if provider == "openai":
            await run_openai_stream(websocket, language)
        else:
            await run_local_stream(websocket, language)


async def run_local_stream(websocket, language):
    send_lock = asyncio.Lock()

    async def send_json(payload):
        async with send_lock:
            await websocket.send_json(payload)

    chunks = []
    samples = 0
    last_inferred_samples = 0
    inference_task = None
    latest_segments = []
    caption_words = []
    asr_queue = asyncio.Queue()

    def captions_payload():
        items = []
        for part in caption_words:
            scores = {}
            for segment in latest_segments:
                overlap = max(0.0, min(part["end"], segment["end"]) - max(part["start"], segment["start"]))
                if overlap:
                    scores[segment["speaker"]] = scores.get(segment["speaker"], 0.0) + overlap
            total = sum(scores.values())
            best = max(scores, key=scores.get) if scores else None
            speaker = best if total and scores[best] / total >= 0.65 else None
            word = part["text"]
            text = word if word[:1] in ".,!?;:" else f" {word}"
            items.append({**part, "text": text, "speaker": speaker})
        return {"type": "captions", "language": language, "items": items}

    async def asr_worker():
        asr = WindowedASR(asr_model, language)
        audio_parts = []
        processed_samples = 0
        last_asr_samples = 0
        while True:
            audio_chunk = await asr_queue.get()
            if audio_chunk is None:
                break
            audio_parts.append(audio_chunk)
            processed_samples += len(audio_chunk)
            if processed_samples - last_asr_samples < ASR_UPDATE_SECONDS * SAMPLE_RATE:
                continue
            last_asr_samples = processed_samples
            async with model_lock:
                words = await asyncio.to_thread(asr.update, np.concatenate(audio_parts))
                log_gpu(f"ASR {processed_samples / SAMPLE_RATE:.1f}s")
            caption_words[:] = words
            await send_json(captions_payload())
        if processed_samples - last_asr_samples >= SAMPLE_RATE // 2:
            async with model_lock:
                words = await asyncio.to_thread(asr.update, np.concatenate(audio_parts))
                log_gpu(f"ASR final {processed_samples / SAMPLE_RATE:.1f}s")
            caption_words[:] = words
            await send_json(captions_payload())

    async def infer_and_send(snapshot):
        async with model_lock:
            segments = await asyncio.to_thread(infer, snapshot)
        latest_segments[:] = segments
        await send_json({"type": "segments", "duration": len(snapshot) / SAMPLE_RATE, "segments": segments})
        if caption_words:
            await send_json(captions_payload())

    asr_task = asyncio.create_task(asr_worker())
    try:
        await send_json({"type": "ready", "diarization_model": MODEL_ID, "asr_model": ASR_MODEL_ID, "language": language})
        while True:
            packet = await websocket.receive()
            if packet["type"] == "websocket.disconnect":
                break
            if packet.get("text"):
                try:
                    command = json.loads(packet["text"])
                except json.JSONDecodeError:
                    continue
                if command.get("type") == "stop":
                    break
                continue
            data = packet.get("bytes")
            if not data:
                continue
            if len(data) % 4:
                await send_json({"type": "error", "message": "Invalid PCM frame"})
                break
            chunk = np.frombuffer(data, dtype="<f4").copy()
            if not np.isfinite(chunk).all():
                continue
            remaining = MAX_SECONDS * SAMPLE_RATE - samples
            chunk = chunk[:remaining]
            if len(chunk):
                chunks.append(chunk)
                samples += len(chunk)
                asr_queue.put_nowait(chunk)
            if samples - last_inferred_samples >= UPDATE_SECONDS * SAMPLE_RATE:
                if inference_task is None or inference_task.done():
                    if inference_task is not None:
                        await inference_task
                    snapshot = np.concatenate(chunks)
                    last_inferred_samples = samples
                    inference_task = asyncio.create_task(infer_and_send(snapshot))
            if samples >= MAX_SECONDS * SAMPLE_RATE:
                await send_json({"type": "limit", "message": "60-second spike limit reached."})
                break
    except WebSocketDisconnect:
        pass
    finally:
        asr_queue.put_nowait(None)
        try:
            await asr_task
        except Exception as exc:
            log.exception("ASR inference failed")
            try:
                await send_json({"type": "error", "message": f"ASR inference failed: {exc}"})
            except Exception:
                pass
        if inference_task is not None:
            try:
                await inference_task
            except Exception:
                log.exception("Final inference failed")
        if chunks and samples > last_inferred_samples + SAMPLE_RATE // 2:
            try:
                await infer_and_send(np.concatenate(chunks))
            except Exception:
                pass
        try:
            await websocket.close()
        except RuntimeError:
            pass


async def run_openai_stream(websocket, language):
    send_lock = asyncio.Lock()
    chunks = []
    samples = 0
    last_inferred_samples = 0
    inference_task = None
    latest_segments = []

    async def send_json(payload):
        async with send_lock:
            await websocket.send_json(payload)

    def captions_payload():
        items = []
        for turn in sorted(transcriber.turns, key=lambda item: item["start"]):
            if not turn["text"].strip():
                continue
            scores = {}
            for segment in latest_segments:
                overlap = max(0.0, min(turn["end"], segment["end"]) - max(turn["start"], segment["start"]))
                if overlap:
                    scores[segment["speaker"]] = scores.get(segment["speaker"], 0.0) + overlap
            total = sum(scores.values())
            best = max(scores, key=scores.get) if scores else None
            duration = max(0.001, turn["end"] - turn["start"])
            speaker = best if best is not None and scores[best] / total >= 0.65 and total / duration >= 0.2 else None
            items.append({
                "start": turn["start"],
                "end": turn["end"],
                "text": " " + turn["text"].strip(),
                "speaker": speaker,
                "final": turn["final"],
            })
        return {"type": "captions", "language": language, "provider": "openai", "items": items}

    async def on_transcription(_turns):
        await send_json(captions_payload())

    async def infer_and_send(snapshot):
        async with model_lock:
            segments = await asyncio.to_thread(infer, snapshot)
        latest_segments[:] = segments
        await send_json({"type": "segments", "duration": len(snapshot) / SAMPLE_RATE, "segments": segments})
        if transcriber.turns:
            await send_json(captions_payload())

    transcriber = OpenAILiveASR(openai_api_key(), language, on_transcription)
    try:
        await transcriber.start()
    except Exception as exc:
        log.exception("OpenAI transcription connection failed")
        await send_json({"type": "error", "message": f"OpenAI transcription unavailable: {exc}"})
        await websocket.close()
        return

    try:
        await send_json({"type": "ready", "diarization_model": MODEL_ID, "asr_model": OPENAI_ASR_MODEL_ID, "language": language})
        while True:
            packet = await websocket.receive()
            if transcriber.failure:
                raise transcriber.failure
            if packet["type"] == "websocket.disconnect":
                break
            if packet.get("text"):
                try:
                    command = json.loads(packet["text"])
                except json.JSONDecodeError:
                    continue
                if command.get("type") == "stop":
                    break
                continue
            data = packet.get("bytes")
            if not data:
                continue
            if len(data) % 4:
                raise ValueError("Invalid PCM frame")
            chunk = np.frombuffer(data, dtype="<f4").copy()
            if not np.isfinite(chunk).all():
                continue
            remaining = MAX_SECONDS * SAMPLE_RATE - samples
            chunk = chunk[:remaining]
            if len(chunk):
                chunks.append(chunk)
                samples += len(chunk)
                await transcriber.append(chunk)
            if samples - last_inferred_samples >= UPDATE_SECONDS * SAMPLE_RATE:
                if inference_task is None or inference_task.done():
                    if inference_task is not None:
                        await inference_task
                    snapshot = np.concatenate(chunks)
                    last_inferred_samples = samples
                    inference_task = asyncio.create_task(infer_and_send(snapshot))
            if samples >= MAX_SECONDS * SAMPLE_RATE:
                await send_json({"type": "limit", "message": "60-second spike limit reached."})
                break
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.exception("OpenAI live session failed")
        try:
            await send_json({"type": "error", "message": f"OpenAI transcription failed: {exc}"})
        except Exception:
            pass
    finally:
        try:
            await transcriber.finish()
        except Exception as exc:
            log.exception("OpenAI transcription did not finish")
            try:
                await send_json({"type": "error", "message": f"OpenAI transcription did not finish: {exc}"})
            except Exception:
                pass
        if inference_task is not None:
            try:
                await inference_task
            except Exception:
                log.exception("Final diarization inference failed")
        if chunks and samples > last_inferred_samples + SAMPLE_RATE // 2:
            try:
                await infer_and_send(np.concatenate(chunks))
            except Exception:
                log.exception("Final diarization inference failed")
        try:
            await websocket.close()
        except RuntimeError:
            pass
