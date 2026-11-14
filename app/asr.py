"""Streaming speech recognition for live word highlighting while a script is read aloud."""

import json
from functools import lru_cache

import numpy as np


@lru_cache(maxsize=1)
def recognizer(model_dir):
    """One recognizer per process; streams are per connection. None when the model is absent."""
    if not (model_dir / "encoder.onnx").exists():
        return None
    import sherpa_onnx

    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(model_dir / "tokens.txt"),
        encoder=str(model_dir / "encoder.onnx"),
        decoder=str(model_dir / "decoder.onnx"),
        joiner=str(model_dir / "joiner.onnx"),
        num_threads=1,
        sample_rate=16000,
        feature_dim=80,
        decoding_method="greedy_search",
        enable_endpoint_detection=False,  # one segment per take: the text accumulates
    )


def feed(rec, stream, rate, chunk):
    """Decodes a chunk of little-endian float32 mono samples.

    Returns the words heard so far with their start time in the stream: [["TODAY", 0.4], ...].
    """
    stream.accept_waveform(rate, np.frombuffer(chunk, dtype="<f4"))
    while rec.is_ready(stream):
        rec.decode_stream(stream)
    result = json.loads(rec.get_result_as_json_string(stream))
    words = []
    for token, start in zip(result["tokens"], result["timestamps"]):
        if token.startswith(" ") or not words:  # a leading space starts a new word
            words.append([token.strip(), round(start, 2)])
        else:
            words[-1][0] += token
    return words
