"""Low-latency, timestamped multilingual ASR for the microphone spike."""

import gc
import re

import numpy as np
import torch

ASR_MODEL_ID = "nvidia/nemotron-3.5-asr-streaming-0.6b"
WINDOW_SECONDS = 15
SUPPORTED_LANGUAGES = {
    "auto", "pt-PT", "pt-BR", "en-US", "en-GB", "es-ES", "es-US",
    "fr-FR", "fr-CA", "it-IT", "de-DE", "nl-NL", "ru-RU", "uk-UA",
    "pl-PL", "sv-SE", "cs-CZ", "da-DK", "fi-FI", "ro-RO",
}
LANG_TAG = re.compile(r"<[a-z]{2}(?:-[A-Z]{2})?>")


def load_asr_model():
    from nemo.collections.asr.models import ASRModel

    model = ASRModel.from_pretrained(model_name=ASR_MODEL_ID)
    model.eval().cuda()
    # Use the regular decoder to avoid CUDA graph behavior with repeated,
    # differently sized rolling windows on this GPU.
    decoder = model.decoding.decoding
    decoder.disable_cuda_graphs()
    decoder.use_cuda_graph_decoder = False
    # Prepare NeMo's timestamp decoder before the first live utterance.
    with torch.inference_mode():
        model.transcribe(
            audio=[np.zeros(2 * 16000, dtype=np.float32)],
            batch_size=1,
            target_lang="pt-PT",
            timestamps=True,
            verbose=False,
        )
    return model


class WindowedASR:
    """Revise recent words while retaining older, stable captions."""

    def __init__(self, model, language):
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Unsupported language: {language}")
        self.model = model
        self.language = language
        self.words = []

    def update(self, audio, sample_rate=16000):
        end = len(audio) / sample_rate
        start = max(0.0, end - WINDOW_SECONDS)
        window = np.asarray(audio[int(start * sample_rate):], dtype=np.float32)
        with torch.inference_mode():
            result = self.model.transcribe(
                audio=[window],
                batch_size=1,
                target_lang=self.language,
                timestamps=True,
                verbose=False,
            )[0]
        stamps = result.timestamp.get("word", [])
        new_words = []
        for stamp in stamps:
            word = LANG_TAG.sub("", str(stamp.get("word", ""))).strip()
            word_start = start + float(stamp["start"])
            word_end = start + float(stamp["end"])
            if word and 0 <= word_start < word_end <= end + 0.5:
                new_words.append({"start": word_start, "end": word_end, "text": word})
        # Timestamp hypotheses can form reference cycles containing GPU tensors.
        # Collect them now instead of letting each update retain GPU memory.
        del result, stamps
        gc.collect()
        # Keep only words outside the next revision window.
        boundary = start + (0.5 if start else 0.0)
        self.words = [word for word in self.words if word["end"] <= boundary]
        self.words.extend(word for word in new_words if word["end"] > boundary)
        return self.words
