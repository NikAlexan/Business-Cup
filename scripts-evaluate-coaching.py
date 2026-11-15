"""One explicit live coaching probe: pinned public speech, at most two paid API calls, no retries."""

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
from app.focus import RUBRIC_VERSION
from app.provider import EXERCISE_PROMPT_VERSION, OpenAIAudioProvider, ProviderFailure, wav_bytes

PHRASES = [
    "The path curved toward the river.",
    "I stopped by the bridge and waited for the small boat to pass.",
]
TEXT = " ".join(PHRASES)
ROOT = Path(__file__).resolve().parent
HUMAN_MANIFEST = ROOT / "docs/improvements/evaluations/human-corpus-v1.json"


def human_fixture(case_id):
    corpus = json.loads(HUMAN_MANIFEST.read_text())
    case = next(c for c in corpus["cases"] if c["id"] == case_id)
    relevant = [source for source in corpus["files"] if source["voice"] == case["voice"]]
    cache = ROOT / "models/evaluation-corpus"
    for source in relevant:
        if hashlib.sha256((cache / source["relative_path"]).read_bytes()).hexdigest() != source["sha256"]:
            raise RuntimeError("human_corpus_source_checksum_mismatch")
    audio = next(source for source in relevant if source["relative_path"].endswith(".wav"))
    signal, rate = sf.read(cache / audio["relative_path"], dtype="float32")
    if rate != 16000 or signal.ndim != 1:
        raise RuntimeError("unexpected_human_fixture_format")
    edits = []
    if case["inserted_pause_seconds"]:
        cut = round(case["insert_at_seconds"] * rate)
        fade = round(0.003 * rate)
        if not fade < cut < len(signal) - fade:
            raise RuntimeError("invalid_human_fixture_cut")
        signal[cut - fade : cut] *= np.linspace(1, 0, fade)
        signal[cut : cut + fade] *= np.linspace(0, 1, fade)
        signal = np.concatenate(
            [
                signal[:cut],
                np.zeros(round(case["inserted_pause_seconds"] * rate), dtype="float32"),
                signal[cut:],
            ]
        )
        edits = [
            {"kind": "declick_fade", "seconds_each_side": 0.003},
            {
                "kind": "inserted_silence",
                "source_start_seconds": case["insert_at_seconds"],
                "seconds": case["inserted_pause_seconds"],
            },
        ]
    return signal, corpus, case, audio, edits


class BoundedProvider(OpenAIAudioProvider):
    def __init__(self, settings):
        super().__init__(settings)
        self.call_count = 0

    def request(self, endpoint, **kwargs):
        if self.call_count >= 2:
            raise RuntimeError("live_probe_call_limit")
        self.call_count += 1
        return super().request(endpoint, **kwargs)


def run(
    output, transcription_only=False, cached_transcript=None, practice_intent="experiment", human_case=None
):
    result = {
        "schema_version": "live-coaching-probe-v1",
        "prompt_version": EXERCISE_PROMPT_VERSION,
        "practice_intent": practice_intent,
        "rubric_version": RUBRIC_VERSION,
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
            if human_case:
                signal, corpus, case, source, edits = human_fixture(human_case)
                practice_intent = case["intent"]
                result.update(
                    scope="public_human_recording_with_declared_edits",
                    human_case=case,
                    source_audio=source,
                    edits=edits,
                    expected_text=corpus["source_text"],
                    practice_intent=practice_intent,
                    inserted_pause_seconds=case["inserted_pause_seconds"],
                    limitations=corpus["limits"] + result["limitations"][1:],
                )
            else:
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
                    or cached.get("expected_text") != result["expected_text"]
                    or cached.get("transcribe_model") != settings.transcribe_model
                ):
                    raise RuntimeError("cached_transcript_does_not_match_synthetic_audio")
                transcript = cached["transcription"]
                result["cached_transcription_source"] = str(cached_transcript)
            else:
                provider = BoundedProvider(settings)
                transcript = provider.transcribe(signal, result["expected_text"])
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
                        "title": "Read a short narrative phrase"
                        if human_case
                        else "Pause at a thought boundary",
                        "task": {
                            "text": result["expected_text"],
                            "instruction": "Read the phrase comfortably, keeping connected word groups together."
                            if human_case
                            else "Read both thoughts comfortably, leaving room between them.",
                        },
                        "practice_intent": practice_intent,
                        "saved_focus": case["saved_focus"]
                        if human_case
                        else {
                            "experiment": "Explore the boundary between these two thoughts.",
                            "keep": "Keep the pause that lets the first thought land, without making it longer.",
                            "undecided": "Listen to the thought boundary again before choosing a change.",
                        }[practice_intent],
                        "story_focus": {
                            "skill_label": "Meaningful pauses",
                            "listening_question": "Does the pause help one thought land before the next?",
                            "rubric_version": RUBRIC_VERSION,
                        },
                        "verified_transcript": transcript["text"],
                        "measurements": metrics,
                    },
                )
                result["report"] = report  # Keep the response even if evidence validation fails.
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
    parser.add_argument("--intent", choices=("experiment", "keep", "undecided"))
    parser.add_argument(
        "--human-case", choices=[c["id"] for c in json.loads(HUMAN_MANIFEST.read_text())["cases"]]
    )
    args = parser.parse_args()
    if args.human_case and args.intent:
        parser.error("Human cases use the intention frozen in their manifest; omit --intent")
    raise SystemExit(
        run(
            args.output,
            args.transcription_only,
            args.cached_transcript,
            args.intent or "experiment",
            args.human_case,
        )
    )
