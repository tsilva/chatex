"""Exercise the browser relay and speaker assignment without a GPU or API key."""

import asyncio
import json
import unittest
from unittest.mock import patch

import numpy as np
import websockets

import app
from openai_live import OpenAILiveASR


class FakeBrowserSocket:
    def __init__(self, audio):
        self.packets = iter((
            {"type": "websocket.receive", "bytes": audio.tobytes()},
            {"type": "websocket.receive", "text": '{"type":"stop"}'},
        ))
        self.messages = []

    async def receive(self):
        return next(self.packets)

    async def send_json(self, payload):
        self.messages.append(payload)

    async def close(self):
        pass


class AppRelayTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_caption_is_assigned_after_diarization(self):
        async def mock_openai(socket):
            await socket.recv()  # session.update
            await socket.send(json.dumps({"type": "session.updated"}))
            async for raw in socket:
                if json.loads(raw)["type"] == "input_audio_buffer.commit":
                    await socket.send(json.dumps({"type": "input_audio_buffer.committed", "item_id": "one"}))
                    await socket.send(json.dumps({
                        "type": "conversation.item.input_audio_transcription.completed",
                        "item_id": "one", "transcript": "Bom dia.",
                    }))

        async with websockets.serve(mock_openai, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            browser = FakeBrowserSocket(np.full(2 * 16000, 0.1, dtype="<f4"))

            def transcriber(key, language, on_change):
                return OpenAILiveASR(key, language, on_change, f"ws://127.0.0.1:{port}")

            with patch.object(app, "OpenAILiveASR", transcriber), patch.object(
                app, "openai_api_key", return_value="test-key"
            ), patch.object(app, "infer", return_value=[{"start": 0.0, "end": 2.0, "speaker": 0}]):
                await asyncio.wait_for(app.run_openai_stream(browser, "pt-PT"), 5)

        captions = [message for message in browser.messages if message["type"] == "captions"]
        self.assertEqual(captions[-1]["items"][0]["text"].strip(), "Bom dia.")
        self.assertEqual(captions[-1]["items"][0]["speaker"], 0)
        self.assertTrue(captions[-1]["items"][0]["final"])


if __name__ == "__main__":
    unittest.main()
