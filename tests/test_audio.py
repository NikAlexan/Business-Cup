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
    new = {
        "measurements": m,
        "analysis_metadata": {"measurement_version": MEASUREMENT_VERSION},
        "protocol_version": "assessment-v2",
        "recording_conditions": {"device_label": "same mic"},
    }
    assert comparable_measurements(None, new) is None
    assert comparable_measurements(old, new) is None
    assert comparable_measurements(new, new) is m


def test_same_measurement_version_is_not_enough_when_setup_or_protocol_changed():
    from app.worker import MEASUREMENT_VERSION, comparable_measurements

    baseline = {
        "measurements": {"intonation_range_semitones": {"available": True, "value": 9}},
        "recording_conditions": {"device_label": "old mic"},
        "protocol_version": "assessment-v2",
        "analysis_metadata": {"measurement_version": MEASUREMENT_VERSION},
    }
    new_setup = {**baseline, "recording_conditions": {"device_label": "new mic"}}
    new_protocol = {**baseline, "protocol_version": "assessment-v3"}
    assert comparable_measurements(baseline, new_setup) is None
    assert comparable_measurements(baseline, new_protocol) is None
    assert comparable_measurements(baseline, dict(baseline)) == baseline["measurements"]


def test_invalid_word_timestamps_are_unavailable_without_partial_metrics():
    invalid = [
        [{"start": 0}, {"start": 1, "end": 2}],
        [{"start": 0, "end": 0}, {"start": 0, "end": 0}],
        [{"start": 0, "end": 1}, {"start": 0.5, "end": 2}],
        [{"start": 0, "end": 1}, {"start": 1, "end": float("inf")}],
        [{"start": -1, "end": 0}, {"start": 0, "end": 1}],
        [{"start": 0, "end": 1}, {"start": True, "end": 2}],
        ["not an object", {"start": 1, "end": 2}],
    ]
    for words in invalid:
        result = timing_metrics(np.zeros(16000), [], 2, words)
        assert all(not m["available"] and m["value"] is None for m in result.values())
        assert result["speaking_rate_wpm"]["unavailable_reason"] == "transcription_invalid_timestamps"
