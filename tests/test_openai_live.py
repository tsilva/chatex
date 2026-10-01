import asyncio
import base64
import json
import unittest

import numpy as np
import websockets

from openai_live import OpenAILiveASR, session_update


class LiveTranscriptionTests(unittest.IsolatedAsyncioTestCase):
    def test_portuguese_hint_uses_supported_language_code(self):
        config = session_update("pt-PT")["session"]["audio"]["input"]
        self.assertEqual(config["format"]["rate"], 24000)
        self.assertEqual(config["transcription"]["languages"], ["pt"])
        self.assertIn("European Portuguese", config["transcription"]["prompt"])
        self.assertIsNone(config["turn_detection"])

    async def test_streams_audio_and_reconciles_final_turn(self):
        received_audio = []
        changes = []

        async def mock_openai(socket):
            self.assertEqual(socket.request.headers["Authorization"], "Bearer test-key")
            setup = json.loads(await socket.recv())
            self.assertEqual(setup["session"]["audio"]["input"]["transcription"]["model"], "gpt-live-transcribe")
            await socket.send(json.dumps({"type": "session.updated"}))
            async for raw in socket:
                event = json.loads(raw)
                if event["type"] == "input_audio_buffer.append":
                    received_audio.append(base64.b64decode(event["audio"]))
                elif event["type"] == "input_audio_buffer.commit":
                    await socket.send(json.dumps({"type": "input_audio_buffer.committed", "item_id": "item_1"}))
                    await socket.send(json.dumps({"type": "conversation.item.input_audio_transcription.delta", "item_id": "item_1", "delta": "Bom dia"}))
                    await socket.send(json.dumps({"type": "conversation.item.input_audio_transcription.completed", "item_id": "item_1", "transcript": "Bom dia."}))

        async def on_change(turns):
            changes.append([(turn["text"], turn["final"]) for turn in turns])

        async with websockets.serve(mock_openai, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            relay = OpenAILiveASR("test-key", "pt-PT", on_change, f"ws://127.0.0.1:{port}")
            await relay.start()
            await relay.append(np.full(16000, 0.2, dtype=np.float32))
            await relay.append(np.zeros(16000, dtype=np.float32))
            await relay.finish(timeout=3)

        self.assertEqual(len(received_audio), 2)
        self.assertEqual(len(received_audio[0]), 48000)
        self.assertEqual(relay.turns[0]["text"], "Bom dia.")
        self.assertTrue(relay.turns[0]["final"])
        self.assertEqual((relay.turns[0]["start"], relay.turns[0]["end"]), (0.0, 2.0))
        self.assertIn(("Bom dia", False), changes[0])
        self.assertIn(("Bom dia.", True), changes[-1])


if __name__ == "__main__":
    unittest.main()
