"""Version- and checksum-pinned public model, fetched at build time only."""

import hashlib
import os
import subprocess
from pathlib import Path

URL = "https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx"
SHA256 = "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f"
DEST = Path(os.environ.get("VAD_MODEL_PATH", "models/silero_vad.onnx"))
DEST.parent.mkdir(parents=True, exist_ok=True)
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
        "90",
        URL,
        "-o",
        str(DEST),
    ],
    check=True,
)
if hashlib.sha256(DEST.read_bytes()).hexdigest() != SHA256:
    DEST.unlink(missing_ok=True)
    raise RuntimeError("VAD model checksum mismatch")
print("Verified Silero VAD v5.1.2")
