import numpy as np

from app.audio import timing_metrics


def W(*spans):
    return [{"start": a, "end": b} for a, b in spans]


def test_pauses_are_gaps_between_words():
    m = timing_metrics(np.zeros(16000 * 10), [], 4, W((1, 2), (2.1, 3), (3.6, 4), (5, 6)))
    assert m["pause_count"]["value"] == 2  # 0.6 and 1.0; 0.1 is not a pause
    assert m["pause_total_seconds"]["value"] == 1.6
    assert m["pause_ratio"]["value"] == 0.32  # 1.6 / 5 s span
    assert m["speaking_rate_wpm"]["value"] == 48  # 4 words / 5 s
    assert m["articulation_rate_wpm"]["value"] == round(4 * 60 / 3.4, 2)


def test_edge_silence_is_ignored():
    w = W((1, 2), (2.5, 3))
    assert timing_metrics(np.zeros(16000 * 4), [], 2, w) == timing_metrics(np.zeros(16000 * 30), [], 2, w)


def test_no_words_means_unavailable_not_zero():
    m = timing_metrics(np.zeros(16000 * 5), [(0, 16000)], None, None)
    assert all(not m[k]["available"] and m[k]["value"] is None for k in m)


def test_combine_timing():
    from app.audio import combine_timing

    a = (10, W((0, 2), (3, 5)))  # 5 s span, 1 s pause
    b = (20, W((0, 4), (6, 10)))  # 10 s span, 2 s pause
    m = combine_timing(a, b)
    assert m["speaking_rate_wpm"]["value"] == 120
    assert m["pause_ratio"]["value"] == 0.2 and m["pause_count"]["value"] == 2
    assert m["articulation_rate_wpm"]["value"] == 150
    assert all(not v["available"] for v in combine_timing(a, (None, [])).values())


def test_interpretation_ignores_incomparable_baseline():
    from app.worker import MEASUREMENT_VERSION, comparable_measurements

    m = {"intonation_range_semitones": {"available": True, "value": 9}}
    old = {"measurements": m, "analysis_metadata": {"measurement_version": "voice-metrics-v1"}}
    new = {"measurements": m, "analysis_metadata": {"measurement_version": MEASUREMENT_VERSION}}
    assert comparable_measurements(None) is None
    assert comparable_measurements(old) is None
    assert comparable_measurements(new) is m
