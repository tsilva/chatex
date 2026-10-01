"""OpenAI live transcription relay for the microphone spike."""

import asyncio
import base64
import json
from collections import deque

import numpy as np
from scipy.signal import resample_poly
import websockets

MODEL_ID = "gpt-live-transcribe"
REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
SAMPLE_RATE = 16_000
OPENAI_SAMPLE_RATE = 24_000
SILENCE_SECONDS = 0.7
MAX_TURN_SECONDS = 8.0
VOICE_RMS = 0.008


def session_update(language):
    transcription = {"model": MODEL_ID, "delay": "low"}
    if language != "auto":
        transcription["languages"] = [language.split("-", 1)[0]]
    if language == "pt-PT":
        transcription["prompt"] = "A conversation in European Portuguese as spoken in Portugal."
    elif language == "pt-BR":
        transcription["prompt"] = "A conversation in Brazilian Portuguese."
    return {
        "type": "session.update",
        "session": {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": OPENAI_SAMPLE_RATE},
                    "transcription": transcription,
                    "turn_detection": None,
                }
            },
        },
    }


def pcm16(audio):
    return (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()


class OpenAILiveASR:
    def __init__(self, api_key, language, on_change, url=REALTIME_URL):
        self.api_key = api_key
        self.language = language
        self.on_change = on_change
        self.url = url
        self.socket = None
        self.receiver = None
        self.turns = []
        self.by_id = {}
        self.pending_ranges = deque()
        self.buffer_start = 0.0
        self.audio_end = 0.0
        self.has_voice = False
        self.last_voice_end = 0.0
        self.failure = None
        self.changed = asyncio.Event()
        self.closing = False

    async def start(self):
        self.socket = await websockets.connect(
            self.url,
            additional_headers={"Authorization": f"Bearer {self.api_key}"},
            open_timeout=10,
            max_size=2_000_000,
        )
        await self.socket.send(json.dumps(session_update(self.language)))
        try:
            async with asyncio.timeout(10):
                async for raw in self.socket:
                    event = json.loads(raw)
                    if event.get("type") == "session.updated":
                        self.receiver = asyncio.create_task(self._receive())
                        return
                    if event.get("type") == "error":
                        raise RuntimeError(_error_message(event))
        except Exception:
            await self.socket.close()
            raise
        raise RuntimeError("OpenAI transcription connection closed before the session was ready")

    async def append(self, audio):
        self.audio_end += len(audio) / SAMPLE_RATE
        encoded = base64.b64encode(pcm16(resample_poly(audio, 3, 2))).decode("ascii")
        await self.socket.send(json.dumps({"type": "input_audio_buffer.append", "audio": encoded}))
        rms = float(np.sqrt(np.mean(np.square(audio)))) if len(audio) else 0.0
        if rms >= VOICE_RMS:
            self.has_voice = True
            self.last_voice_end = self.audio_end
        if self.has_voice and (
            self.audio_end - self.last_voice_end >= SILENCE_SECONDS
            or self.audio_end - self.buffer_start >= MAX_TURN_SECONDS
        ):
            await self.commit()

    async def commit(self):
        if not self.has_voice or self.audio_end <= self.buffer_start:
            return
        self.pending_ranges.append((self.buffer_start, self.audio_end))
        await self.socket.send(json.dumps({"type": "input_audio_buffer.commit"}))
        self.buffer_start = self.audio_end
        self.has_voice = False

    async def finish(self, timeout=15):
        try:
            await self.commit()
            async with asyncio.timeout(timeout):
                while True:
                    self.changed.clear()
                    if self.failure:
                        raise self.failure
                    if not self.pending_ranges and all(turn["final"] for turn in self.turns):
                        break
                    await self.changed.wait()
            if self.failure:
                raise self.failure
        finally:
            self.closing = True
            if self.socket is not None:
                await self.socket.close()
            if self.receiver is not None:
                await asyncio.gather(self.receiver, return_exceptions=True)

    async def _receive(self):
        try:
            async for raw in self.socket:
                event = json.loads(raw)
                kind = event.get("type")
                item_id = event.get("item_id")
                if kind == "error":
                    raise RuntimeError(_error_message(event))
                if kind == "input_audio_buffer.committed" and item_id:
                    start, end = self.pending_ranges.popleft() if self.pending_ranges else (self.buffer_start, self.audio_end)
                    turn = self._turn(item_id)
                    turn.update(start=start, end=end, committed=True)
                    if turn["text"]:
                        await self.on_change(self.turns)
                elif kind == "conversation.item.input_audio_transcription.delta" and item_id:
                    turn = self._turn(item_id)
                    if not turn["committed"]:
                        turn["end"] = max(turn["end"], self.audio_end)
                    turn["text"] += event.get("delta", "")
                    await self.on_change(self.turns)
                elif kind == "conversation.item.input_audio_transcription.completed" and item_id:
                    turn = self._turn(item_id)
                    turn["text"] = event.get("transcript", "")
                    turn["final"] = True
                    await self.on_change(self.turns)
                self.changed.set()
            if not self.closing:
                raise RuntimeError("OpenAI transcription connection closed unexpectedly")
        except Exception as exc:
            self.failure = exc
            self.changed.set()

    def _turn(self, item_id):
        turn = self.by_id.get(item_id)
        if turn is None:
            turn = {
                "start": self.buffer_start,
                "end": self.audio_end,
                "text": "",
                "final": False,
                "committed": False,
                "item_id": item_id,
            }
            self.by_id[item_id] = turn
            self.turns.append(turn)
        return turn


def _error_message(event):
    error = event.get("error") or {}
    return error.get("message") or "OpenAI transcription failed"
