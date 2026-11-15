"""Public listening contrasts and descriptive timing at a user-selected thought boundary."""

import json
import math
from pathlib import Path

from app.audio import SAMPLE_RATE, valid_word_timestamps
from app.provider import words

CATALOG = json.loads((Path(__file__).parent / "content/listening-examples.json").read_text())


def example_for(exercise_id):
    return CATALOG["examples"].get(CATALOG["default_by_exercise"].get(exercise_id))


def listening_words(text):
    return words(text.replace("’", "'").replace("‘", "'"))


def boundaries(task):
    phrases = [part.strip() for part in task["text"].split("/")]
    result, count = [], 0
    for index, phrase in enumerate(phrases[:-1]):
        count += len(listening_words(phrase))
        result.append(
            {"index": index, "before": phrase, "after": phrases[index + 1], "word_index": count - 1}
        )
    return result


def planned_pause_feedback(plan, transcript, duration):
    missing = {
        "version": "planned-boundary-v1",
        "available": False,
        "gap_seconds": None,
        "evidence": None,
        "unavailable_reason": "boundary_alignment_unavailable",
    }
    if not plan or not transcript.get("verified"):
        return {**missing, "unavailable_reason": "reliable_transcription_unavailable"}
    timing, recognized = transcript.get("words") or [], transcript.get("recognized_words") or []
    if (
        not valid_word_timestamps(timing)
        or not isinstance(recognized, list)
        or len(recognized) != len(timing)
        or not math.isfinite(duration)
        or duration <= 0
        or timing[-1]["end"] > duration + 0.05
        or timing[-1]["start"] >= duration
    ):
        return missing
    expected = plan["expected_words"]
    boundary = plan["boundary_word_index"]
    first, last = max(0, boundary - 2), min(len(expected), boundary + 4)
    wanted = expected[first:last]
    if len(wanted) < 4:
        return missing
    # A repeated phrase in the authored passage cannot locate this selected boundary uniquely.
    if sum(expected[i : i + len(wanted)] == wanted for i in range(len(expected) - len(wanted) + 1)) != 1:
        return {**missing, "unavailable_reason": "ambiguous_boundary_phrase"}
    actual, frames = [], []
    for frame, word in enumerate(recognized):
        if not isinstance(word, str):
            return missing
        tokens = listening_words(word)
        actual.extend(tokens)
        frames.extend([frame] * len(tokens))
    for start in range(len(actual) - len(wanted) + 1):
        if actual[start : start + len(wanted)] != wanted:
            continue
        position = start + boundary - first
        before, after = frames[position], frames[position + 1]
        if after != before + 1 or any(
            timing[i]["end"] - timing[i]["start"] < 1 / SAMPLE_RATE for i in (before, after)
        ):
            continue
        return {
            "version": "planned-boundary-v1",
            "available": True,
            "gap_seconds": round(timing[after]["start"] - timing[before]["end"], 3),
            "source": "transcript_timing",
            "unavailable_reason": None,
            "evidence": {
                "quote": recognized[before].strip() + " … " + recognized[after].strip(),
                "start_seconds": max(0, timing[before]["start"] - 0.2),
                "end_seconds": min(duration, timing[after]["end"] + 0.2),
            },
        }
    return missing
