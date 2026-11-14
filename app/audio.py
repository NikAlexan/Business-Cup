"""Deterministic audio decoding, Silero ONNX VAD and pYIN measurements."""

import functools
import math
import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import onnxruntime as ort
import soundfile as sf

SAMPLE_RATE = 16000
QUALITY_RULES = {
    "min_speech_seconds": 5,
    "exercise_min_speech_seconds": 1.5,
    "max_clipping_ratio": 0.02,
    "min_speech_noise_db": 3,
}


class AudioRejected(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


@functools.lru_cache(maxsize=1)
def vad_session(path):
    if not Path(path).is_file():
        raise RuntimeError("vad_not_configured")
    options = ort.SessionOptions()
    options.inter_op_num_threads = options.intra_op_num_threads = 1
    return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def decode(path, settings, max_seconds):
    # Limit decoded duration, memory and protocols; never interpret user filenames as flags.
    with tempfile.TemporaryDirectory(prefix="voice-decode-") as temp:
        output = Path(temp) / "decoded.wav"
        try:
            subprocess.run(
                [
                    settings.ffmpeg_path,
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-i",
                    str(path),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    str(SAMPLE_RATE),
                    "-t",
                    str(max_seconds + 1),
                    "-c:a",
                    "pcm_s16le",
                    str(output),
                ],
                check=True,
                timeout=45,
                capture_output=True,
            )
            signal, sr = sf.read(output, dtype="float32")
        except FileNotFoundError:
            raise RuntimeError("ffmpeg_not_configured") from None
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, sf.LibsndfileError):
            raise AudioRejected(
                "decode_failed", "This recording could not be decoded. Please record again."
            ) from None
    if sr != SAMPLE_RATE or not len(signal):
        raise AudioRejected("decode_failed", "The recording contains no decodable audio.")
    if len(signal) / sr > max_seconds + 0.01:
        raise AudioRejected("too_long", f"Please keep this recording under {max_seconds} seconds.")
    return signal


def speech_segments(signal, model_path):
    session = vad_session(str(model_path))
    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros((1, 64), dtype=np.float32)
    segments = []
    start = None
    last_speech_end = 0
    for offset in range(0, len(signal), 512):
        chunk = np.pad(signal[offset : offset + 512], (0, max(0, offset + 512 - len(signal))))[None, :]
        data = np.concatenate([context, chunk], axis=1)
        probability, state = session.run(
            None, {"input": data, "state": state, "sr": np.array(SAMPLE_RATE, dtype=np.int64)}
        )
        context = data[:, -64:]
        if float(probability[0][0]) >= 0.5:
            if start is None:
                start = offset
            last_speech_end = min(offset + 512, len(signal))
        elif start is not None and offset - last_speech_end >= int(0.3 * SAMPLE_RATE):
            if last_speech_end - start >= int(0.2 * SAMPLE_RATE):
                segments.append((start, last_speech_end))
            start = None
    if start is not None and last_speech_end - start >= int(0.2 * SAMPLE_RATE):
        segments.append((start, last_speech_end))
    return segments


def quality_check(signal, settings, purpose, rules=None):
    rules = QUALITY_RULES if rules is None else rules
    duration = len(signal) / SAMPLE_RATE
    segments = speech_segments(signal, settings.vad_model_path)
    speech_seconds = sum(b - a for a, b in segments) / SAMPLE_RATE
    clipping = float(np.mean(np.abs(signal) >= 0.999))
    mask = np.zeros(len(signal), dtype=bool)
    for a, b in segments:
        mask[a:b] = True
    noise_level = "unavailable"
    if mask.any() and (~mask).sum() > SAMPLE_RATE * 0.2:
        speech_rms = float(np.sqrt(np.mean(signal[mask] ** 2)))
        noise_rms = float(np.sqrt(np.mean(signal[~mask] ** 2)))
        snr = 20 * math.log10(max(speech_rms, 1e-8) / max(noise_rms, 1e-8))
        noise_level = "low" if snr >= 15 else "moderate" if snr >= rules["min_speech_noise_db"] else "high"
    issues = []
    minimum = rules["min_speech_seconds"] if purpose == "assessment" else rules["exercise_min_speech_seconds"]
    if speech_seconds < minimum:
        issues.append(
            {
                "code": "no_speech" if not segments else "too_short",
                "message": f"Please record at least {minimum} seconds of audible speech.",
            }
        )
    if clipping > rules["max_clipping_ratio"]:
        issues.append(
            {"code": "clipping", "message": "Move farther from the microphone or lower its input volume."}
        )
    if noise_level == "high":
        issues.append({"code": "excessive_noise", "message": "Please record in a quieter place."})
    return {
        "status": "rejected" if issues else "accepted",
        "duration_seconds": round(duration, 3),
        "speech_seconds": round(speech_seconds, 3),
        "clipping_ratio": round(clipping, 6),
        "noise_level": noise_level,
        "issues": issues,
    }, segments


def metric(value, unit, reason=None):
    return {
        "available": value is not None,
        "value": value,
        "unit": unit,
        "unavailable_reason": reason if value is None else None,
    }


def pitch(signal):
    # pYIN uses low-pass resampling to keep full 3-minute processing bounded on CPU.
    down = librosa.resample(signal, orig_sr=SAMPLE_RATE, target_sr=8000)
    f0, voiced, _ = librosa.pyin(down, sr=8000, fmin=65, fmax=600, frame_length=512, hop_length=160)
    valid = np.isfinite(f0) & voiced
    reliable = bool(valid.sum() >= 25)
    values = f0[valid]
    reason = "insufficient_voiced_audio"
    median = round(float(np.median(values)), 2) if reliable else None
    limits = (
        {"p10": round(float(np.percentile(values, 10)), 2), "p90": round(float(np.percentile(values, 90)), 2)}
        if reliable
        else None
    )
    span = round(12 * math.log2(limits["p90"] / limits["p10"]), 2) if reliable else None
    points = [
        {"time_seconds": round(i * 0.02, 3), "value": round(float(v), 2) if valid[i] else None}
        for i, v in enumerate(f0)
        if i % 5 == 0
    ]
    return {
        "f0_median_hz": metric(median, "Hz", reason),
        "f0_range_hz": metric(limits, "Hz", reason),
        "f0_timeline": {
            "available": reliable,
            "unavailable_reason": None if reliable else reason,
            "unit": "Hz",
            "points": points if reliable else [],
        },
    }, metric(span, "semitones", reason)


def timing_metrics(signal, segments, word_count=None, words=None):
    # Pauses are gaps between transcribed words: Silero VAD holds speech probability through
    # sentence pauses, and edge silence must not dilute pace. segments stay for quality checks.
    return combine_timing((word_count, words))


def valid_word_timestamps(words):
    if not isinstance(words, list) or len(words) < 2:
        return False
    previous_end = 0
    for word in words:
        if not isinstance(word, dict):
            return False
        start, end = word.get("start"), word.get("end")
        if any(
            isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
            for v in (start, end)
        ):
            return False
        if start < previous_end or end <= start:
            return False
        previous_end = end
    return True


def combine_timing(*parts):
    """Timing pooled over (word_count, words) parts; unavailable if any part lacks words, never partial."""
    total_words = span = pause_time = pause_count = 0
    for word_count, words in parts:
        if not word_count or not words or len(words) < 2:
            return {k: metric(None, u, "transcription_unavailable") for k, u in TIMING_UNITS.items()}
        if not valid_word_timestamps(words):
            return {k: metric(None, u, "transcription_invalid_timestamps") for k, u in TIMING_UNITS.items()}
        pauses = [b["start"] - a["end"] for a, b in zip(words, words[1:])]
        pauses = [g for g in pauses if g >= 0.3]
        total_words += word_count
        span += words[-1]["end"] - words[0]["start"]
        pause_time += sum(pauses)
        pause_count += len(pauses)
    return {
        "pause_count": metric(pause_count, "count"),
        "pause_total_seconds": metric(round(pause_time, 3), "s"),
        "pause_ratio": metric(round(pause_time / span, 4), "ratio"),
        "speaking_rate_wpm": metric(round(total_words * 60 / span, 2), "words/min"),
        "articulation_rate_wpm": metric(round(total_words * 60 / (span - pause_time), 2), "words/min"),
    }


TIMING_UNITS = {
    "pause_count": "count",
    "pause_total_seconds": "s",
    "pause_ratio": "ratio",
    "speaking_rate_wpm": "words/min",
    "articulation_rate_wpm": "words/min",
}
