"""Listening prompts and playback anchors grounded in validated transcript timing."""

import re

from app.audio import SAMPLE_RATE, valid_word_timestamps


def quote_evidence(quote, transcript, duration, occurrence=1):
    """Locate model-selected words in ASR output; never accept a model-invented timestamp."""

    def tokenize(text):
        return re.findall(r"[a-zA-Z0-9]+(?:'[a-zA-Z]+)?", text.lower())

    timing = transcript.get("words") or []
    if (
        len(transcript.get("recognized_words", [])) != len(timing)
        or not valid_word_timestamps(timing)
        or timing[-1]["end"] > duration + 0.05
        or timing[-1]["start"] >= duration
        or min(duration, timing[-1]["end"]) - timing[0]["start"] < 1 / SAMPLE_RATE
    ):
        return None
    wanted = tokenize(quote)
    if not 2 <= len(wanted) <= 12:
        return None
    tokens, frames = [], []
    for index, word in enumerate(transcript.get("recognized_words", [])):
        if not isinstance(word, str):
            return None
        for token in tokenize(word):
            tokens.append(token)
            frames.append(index)
    for start in range(len(tokens) - len(wanted) + 1):
        if tokens[start : start + len(wanted)] == wanted:
            occurrence -= 1
            if occurrence:
                continue
            first, last = frames[start], frames[start + len(wanted) - 1]
            original = first, last
            while first > 0 and timing[first]["start"] == timing[first]["end"]:
                first -= 1
            while last < len(timing) - 1 and timing[last]["start"] == timing[last]["end"]:
                last += 1
            if last - first + 1 > 16:
                return None
            evidence = {
                "quote": " ".join(transcript["recognized_words"][first : last + 1]),
                "start_seconds": max(0, timing[first]["start"] - 0.2),
                "end_seconds": min(duration, timing[last]["end"] + 0.2),
            }
            if original != (first, last) or any(
                word["start"] == word["end"] for word in timing[first : last + 1]
            ):
                evidence["note"] = (
                    "Some words had no separate time span; replay this wider phrase to check the observation."
                )
            return evidence
    return None


def timing_feedback(transcript, metrics, verification, duration, practice_intent=None):
    pace = metrics.get("speaking_rate_wpm", {})
    pauses = metrics.get("pause_ratio", {})
    result = {
        "version": "speech-timing-feedback-v1",
        "scope": "audio_quality_only",
        "insights": [],
        "next_step": None,
    }
    if not pace.get("available"):
        return result
    result["scope"] = "quality_and_timing"
    result["insights"] = [
        {
            "code": "observed_pace",
            "source": "transcript_timing",
            "message": f"This take: {pace['value']:g} words per minute.",
            "evidence": None,
        },
    ]
    if pauses.get("available"):
        result["insights"].append(
            {
                "code": "observed_pauses",
                "source": "transcript_timing",
                "message": f"Pauses account for {pauses['value']:.0%} of the timed speech span; silence before and after speech is excluded.",
                "evidence": None,
            }
        )
    else:
        result["insights"].append(
            {
                "code": "pause_timing_unavailable",
                "source": "transcript_timing",
                "message": "Some words had no separate time span, so pauses were not measured for this take.",
                "evidence": None,
            }
        )
    timings = transcript.get("words") or []
    recognized = transcript.get("recognized_words") or []
    if pauses.get("available") and len(recognized) == len(timings) and len(timings) >= 2:
        gaps = [(i, b["start"] - a["end"]) for i, (a, b) in enumerate(zip(timings, timings[1:]))]
        index, gap = max(gaps, key=lambda pair: pair[1])
        before, after = recognized[index], recognized[index + 1]
        if (
            gap >= 0.3
            and isinstance(before, str)
            and isinstance(after, str)
            and before.strip()
            and after.strip()
        ):
            result["insights"].append(
                {
                    "code": "longest_pause",
                    "source": "transcript_timing",
                    "message": f"Longest word gap: {gap:.1f} seconds. Listen to whether it helps the thought land.",
                    "evidence": {
                        "quote": before.strip()[:80] + " … " + after.strip()[:80],
                        "start_seconds": max(0, timings[index]["start"] - 0.2),
                        "end_seconds": min(duration, timings[index + 1]["end"] + 0.2),
                    },
                }
            )
    target = verification.get("target_wpm")
    if practice_intent == "keep":
        step = "Listen for the feature you wanted to keep. Carry it into a new phrase without automatically making it stronger."
    elif practice_intent == "undecided":
        step = (
            "Listen to one phrase again before deciding whether to change anything. A new take is optional."
        )
    elif target and pace["value"] > target["max"]:
        step = "On your next take, let one sentence settle before starting the next. Keep your voice comfortable."
    elif target and pace["value"] < target["min"]:
        step = "Try one pass with smoother connections between words. Keep pauses that help the meaning."
    elif target:
        step = "If this pace feels comfortable, keep it in a new phrase. Listen before choosing any further change."
    else:
        step = "Choose one marked thought boundary. Listen to it, then try a different pause there and compare the takes."
    if practice_intent:
        result["practice_intent"] = practice_intent
    result["next_step"] = step
    return result
