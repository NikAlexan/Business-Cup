"""Listening prompts and playback anchors grounded in validated transcript timing."""

import re


def quote_evidence(quote, transcript, duration, occurrence=1):
    """Locate model-selected words in ASR output; never accept a model-invented timestamp."""

    def tokenize(text):
        return re.findall(r"[a-zA-Z0-9]+(?:'[a-zA-Z]+)?", text.lower())

    if len(transcript.get("recognized_words", [])) != len(transcript.get("words", [])):
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
            timing = transcript["words"]
            return {
                "quote": " ".join(transcript["recognized_words"][first : last + 1]),
                "start_seconds": max(0, timing[first]["start"] - 0.2),
                "end_seconds": min(duration, timing[last]["end"] + 0.2),
            }
    return None


def timing_feedback(transcript, metrics, verification, duration):
    pace = metrics.get("speaking_rate_wpm", {})
    pauses = metrics.get("pause_ratio", {})
    result = {
        "version": "speech-timing-feedback-v1",
        "scope": "audio_quality_only",
        "insights": [],
        "next_step": None,
    }
    if not pace.get("available") or not pauses.get("available"):
        return result
    result["scope"] = "quality_and_timing"
    result["insights"] = [
        {
            "code": "observed_pace",
            "source": "transcript_timing",
            "message": f"This take: {pace['value']:g} words per minute.",
            "evidence": None,
        },
        {
            "code": "observed_pauses",
            "source": "transcript_timing",
            "message": f"Pauses account for {pauses['value']:.0%} of the timed speech span; silence before and after speech is excluded.",
            "evidence": None,
        },
    ]
    timings = transcript.get("words") or []
    recognized = transcript.get("recognized_words") or []
    if len(recognized) == len(timings) and len(timings) >= 2:
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
    if target and pace["value"] > target["max"]:
        step = "On your next take, let one sentence settle before starting the next. Keep your voice comfortable."
    elif target and pace["value"] < target["min"]:
        step = "Try one pass with smoother connections between words. Keep pauses that help the meaning."
    elif target:
        step = "Keep this comfortable pace and change the emphasis on one key word in your next take."
    else:
        step = "Choose one marked thought boundary. Listen to it, then try a different pause there and compare the takes."
    result["next_step"] = step
    return result
