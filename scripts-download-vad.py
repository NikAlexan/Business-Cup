"""Version- and checksum-pinned public models, fetched at build time only."""

import hashlib
import os
import subprocess
from pathlib import Path

VAD = Path(os.environ.get("VAD_MODEL_PATH", "models/silero_vad.onnx"))
ASR = Path(os.environ.get("ASR_MODEL_DIR", "models/asr"))
# Streaming zipformer for live word highlighting (Apache-2.0), pinned to a repo revision.
ASR_URL = (
    "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26"
    "/resolve/672fbf1b30579d6585301139bb363f42a0ad4a24/"
)
FILES = [
    (
        "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx",
        "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f",
        VAD,
    ),
    (
        ASR_URL + "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
        "563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1",
        ASR / "encoder.onnx",
    ),
    (
        ASR_URL + "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
        "98da299f471e38bb4e1a8df579b8cc9122d6039576a77e357b3c60f17dd83b02",
        ASR / "decoder.onnx",
    ),
    (
        ASR_URL + "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
        "d944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297",
        ASR / "joiner.onnx",
    ),
    (
        ASR_URL + "tokens.txt",
        "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb",
        ASR / "tokens.txt",
    ),
]

for url, sha256, dest in FILES:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == sha256:
        continue
    subprocess.run(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--retry",
            "3",
            "--max-time",
            "300",
            url,
            "-o",
            str(dest),
        ],
        check=True,
    )
    if hashlib.sha256(dest.read_bytes()).hexdigest() != sha256:
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"Model checksum mismatch: {dest}")
print("Verified Silero VAD v5.1.2 and streaming zipformer ASR")
