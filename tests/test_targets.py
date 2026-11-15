from pathlib import Path

from app.content import TARGETS_VERSION, interpret


def av(v):
    return {"available": True, "value": v, "unit": "", "unavailable_reason": None}


def M(wpm, ratio, st):
    return {
        "speaking_rate_wpm": av(wpm),
        "pause_ratio": av(ratio),
        "intonation_range_semitones": av(st),
        "f0_median_hz": av(88),
    }


def gone(unit, reason):
    return {"available": False, "value": None, "unit": unit, "unavailable_reason": reason}


def test_confident_slow_pace_is_below_and_focus():
    r = interpret("confident_delivery", M(111, 0.31, 9), None)
    assert r["speaking_rate_wpm"]["band"] == "below"
    assert r["speaking_rate_wpm"]["target"] == {"min": 150, "max": 190, "unit": "wpm"}
    assert r["speaking_rate_wpm"]["focus"] is True
    assert r["pause_ratio"]["band"] == "above"
    assert TARGETS_VERSION == "targets-v2"


def test_clear_speech_targets():
    r = interpret("clear_speech", M(145, 0.18, 9), None)
    assert r["speaking_rate_wpm"]["band"] == "within" and not r["speaking_rate_wpm"]["focus"]
    assert r["pause_ratio"]["target"]["min"] == 0.14


def test_expressive_focus_is_intonation_and_pauses():
    r = interpret("expressive_voice", M(100, 0.30, 6), M(100, 0.30, 9))
    assert r["speaking_rate_wpm"]["band"] == "below" and not r["speaking_rate_wpm"]["focus"]
    assert r["pause_ratio"]["focus"] and r["intonation_range_semitones"]["focus"]


def test_pitch_is_never_scored():
    r = interpret("expressive_voice", M(150, 0.15, 9), None)
    assert r["f0_median_hz"]["band"] is None and r["f0_median_hz"]["focus"] is False
    assert r["f0_median_hz"]["label"] == "Your natural pitch"
    assert r["f0_median_hz"]["note"] == "for reference, not a score"


def test_unavailable_metric_has_no_band():
    m = M(150, 0.15, 9)
    m["speaking_rate_wpm"] = gone("words/min", "transcription_unavailable")
    r = interpret("confident_delivery", m, None)
    assert r["speaking_rate_wpm"]["band"] is None and r["speaking_rate_wpm"]["focus"] is False


def test_intonation_vs_baseline():
    assert (
        interpret("expressive_voice", M(150, 0.15, 6), M(150, 0.15, 9))["intonation_range_semitones"]["band"]
        == "below"
    )
    assert (
        interpret("confident_delivery", M(150, 0.15, 8.5), M(150, 0.15, 9))["intonation_range_semitones"][
            "band"
        ]
        == "within"
    )
    first = interpret("expressive_voice", M(150, 0.15, 6), None)["intonation_range_semitones"]
    assert first["band"] is None and first["note"] == "your starting point"
    prev = M(150, 0.15, 9)
    prev["intonation_range_semitones"] = gone("semitones", "insufficient_voiced_audio")
    assert interpret("expressive_voice", M(150, 0.15, 6), prev)["intonation_range_semitones"]["band"] is None


def test_no_forbidden_words_in_copy():
    text = Path("app/content/targets.json").read_text().lower()
    assert not any(w in text for w in ["normal", "typical", "average"])


def test_expressive_holding_range_is_not_called_narrower():
    r = interpret("expressive_voice", M(150, 0.15, 9), M(150, 0.15, 9))["intonation_range_semitones"]
    assert r["band"] == "below" and r["focus"] and r["label"] == "Holding your range"
