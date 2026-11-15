"""One explicit live coaching probe: synthetic public speech, at most two paid API calls, no retries."""

import argparse
import hashlib
import json
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import soundfile as sf

from app.audio import timing_metrics
from app.coaching import quote_evidence
from app.config import Settings
from app.provider import EXERCISE_PROMPT_VERSION, OpenAIAudioProvider, ProviderFailure, wav_bytes

PHRASES = [
    "The path curved toward the river.",
    "I stopped by the bridge and waited for the small boat to pass.",
]
TEXT = " ".join(PHRASES)


class BoundedProvider(OpenAIAudioProvider):
    def __init__(self, settings):
        super().__init__(settings)
        self.call_count = 0

    def request(self, endpoint, **kwargs):
        if self.call_count >= 2:
            raise RuntimeError("live_probe_call_limit")
        self.call_count += 1
        return super().request(endpoint, **kwargs)


def run(output, transcription_only=False, cached_transcript=None):
    result = {
        "schema_version": "live-coaching-probe-v1",
        "prompt_version": EXERCISE_PROMPT_VERSION,
        "api_calls": 0,
        "usage": [],
        "created_at": datetime.now(UTC).isoformat(),
        "scope": "synthetic_speech_only",
        "expected_text": TEXT,
        "inserted_pause_seconds": 1.2,
        "limitations": [
            "One synthesized voice, one passage and one model response do not establish human usefulness or accuracy.",
            "A validated quote locates transcript words; it does not validate the model's perceptual interpretation.",
        ],
    }
    provider = None
    try:
        settings = Settings()
        with tempfile.TemporaryDirectory(prefix="voice-live-coaching-") as directory:
            parts = []
            for index, phrase in enumerate(PHRASES):
                path = Path(directory) / f"part-{index}.wav"
                subprocess.run(
                    [
                        settings.ffmpeg_path,
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        f"flite=text='{phrase}':voice=slt",
                        "-ar",
                        "16000",
                        str(path),
                    ],
                    check=True,
                    capture_output=True,
                )
                signal, rate = sf.read(path, dtype="float32")
                if rate != 16000 or signal.ndim != 1:
                    raise RuntimeError("unexpected_synthetic_audio_format")
                parts.append(signal)
            signal = np.concatenate([parts[0], np.zeros(19200, dtype="float32"), parts[1]])
            duration = len(signal) / 16000
            if duration > 20:
                raise RuntimeError("synthetic_probe_duration_limit")
            result.update(
                duration_seconds=round(duration, 3),
                audio_sha256=hashlib.sha256(wav_bytes(signal)).hexdigest(),
                audio_model=settings.audio_model,
                transcribe_model=settings.transcribe_model,
            )
            if cached_transcript:
                cached = json.loads(cached_transcript.read_text())
                if (
                    cached.get("audio_sha256") != result["audio_sha256"]
                    or cached.get("expected_text") != TEXT
                    or cached.get("transcribe_model") != settings.transcribe_model
                ):
                    raise RuntimeError("cached_transcript_does_not_match_synthetic_audio")
                transcript = cached["transcription"]
                result["cached_transcription_source"] = str(cached_transcript)
            else:
                provider = BoundedProvider(settings)
                transcript = provider.transcribe(signal, TEXT)
            result["transcription"] = transcript
            metrics = timing_metrics(signal, [], transcript["word_count"], transcript["words"])
            result["measurements"] = metrics
            if not metrics["speaking_rate_wpm"]["available"]:
                result["status"] = "unavailable_transcript_timing"
            elif transcription_only:
                result["status"] = "transcription_checked"
            else:
                if provider is None:
                    provider = BoundedProvider(settings)
                report = provider.exercise_review(
                    signal,
                    {
                        "goal": "clear_speech",
                        "title": "Pause at a thought boundary",
                        "task": {
                            "text": TEXT,
                            "instruction": "Read both thoughts comfortably, leaving room between them.",
                        },
                        "saved_focus": "Leave room for the thought to land.",
                        "story_focus": {
                            "skill_label": "Meaningful pauses",
                            "listening_question": "Does the pause help one thought land before the next?",
                            "rubric_version": "story-listening-v1",
                        },
                        "verified_transcript": transcript["text"],
                        "measurements": metrics,
                    },
                )
                observation = report.get("observation")
                if observation:
                    observation["evidence"] = quote_evidence(
                        observation["evidence_quote"], transcript, duration, observation.get("occurrence", 1)
                    )
                    if observation["evidence"] is None:
                        raise ProviderFailure("analysis_invalid_evidence", False)
                result.update(status="completed", report=report)
    except ProviderFailure as exc:
        result.update(status="provider_failed", error_code=exc.code)
    except Exception as exc:
        # Never print config validation inputs, HTTP bodies, credentials or headers.
        result.update(status="probe_failed", error_type=type(exc).__name__)
    finally:
        if provider:
            result.update(api_calls=provider.call_count, usage=provider.usage)
            provider.close()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {"status": result["status"], "api_calls": result.get("api_calls", 0), "artifact": str(output)}
        )
    )
    return 0 if result["status"] in ("completed", "transcription_checked") else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-paid-calls", action="store_true", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--transcription-only", action="store_true")
    parser.add_argument("--cached-transcript", type=Path)
    args = parser.parse_args()
    raise SystemExit(run(args.output, args.transcription_only, args.cached_transcript))
