"""Offline diagnostic on pinned public human recordings; no provider calls or settings secrets."""

import argparse
import hashlib
import json
import runpy
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

from app.asr import feed, recognizer
from app.audio import quality_check
from app.config import Settings
from app.provider import wav_bytes, words


def run(output):
    root = Path(__file__).resolve().parent
    ns = runpy.run_path(str(root / "scripts-evaluate-coaching.py"))
    corpus = json.loads(ns["HUMAN_MANIFEST"].read_text())
    settings = Settings(
        _env_file=None,
        openai_api_key="",
        app_secret="offline-human-probe-only-32-characters",
        vad_model_path=root / "models/silero_vad.onnx",
        asr_model_dir=root / "models/asr",
    )
    rec = recognizer(settings.asr_model_dir)
    if rec is None:
        raise RuntimeError("Pinned live-highlighting recognizer is unavailable")
    result = {
        "schema_version": "offline-human-probe-v1",
        "created_at": datetime.now(UTC).isoformat(),
        "api_calls": 0,
        "scope": "live_highlighting_ASR_and_audio_quality_only_not_assessment_or_learning",
        "model": "streaming zipformer pinned by scripts-download-vad.py",
        "cases": [],
        "limitations": corpus["limits"]
        + [
            "Streaming ASR timestamps are emission positions for live highlights, not measured word endpoints for assessment timing.",
            "Word matches on this one short passage do not establish accuracy across accents or unseen texts.",
        ],
    }
    for case in corpus["cases"]:
        signal, _, case, source, edits = ns["human_fixture"](case["id"])
        quality, _ = quality_check(signal, settings, "exercise")
        stream = rec.create_stream()
        heard = []
        for offset in range(0, len(signal), 3200):
            heard = feed(rec, stream, 16000, signal[offset : offset + 3200].astype("<f4").tobytes())
        heard = feed(rec, stream, 16000, np.zeros(16000, dtype="<f4").tobytes())
        actual = " ".join(w[0] for w in heard)
        result["cases"].append(
            {
                "case_id": case["id"],
                "source_audio": source,
                "edits": edits,
                "audio_sha256": hashlib.sha256(wav_bytes(signal)).hexdigest(),
                "duration_seconds": len(signal) / 16000,
                "expected_text": corpus["source_text"],
                "recognized_text": actual,
                "heard_word_emission_positions": heard,
                "token_alignment_ratio": SequenceMatcher(
                    None, words(corpus["source_text"]), words(actual), autojunk=False
                ).ratio(),
                "quality": quality,
            }
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "artifact": str(output),
                "api_calls": 0,
                "cases": [
                    (c["case_id"], c["quality"]["status"], c["token_alignment_ratio"])
                    for c in result["cases"]
                ],
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.output)
