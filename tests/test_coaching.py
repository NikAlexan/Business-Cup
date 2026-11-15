import numpy as np
import pytest

from app.audio import timing_metrics
from app.coaching import quote_evidence, timing_feedback


def test_quoted_evidence_uses_the_requested_occurrence_and_rejects_absent_phrases():
    transcript = {
        "recognized_words": ["Say", "this.", "Say", "this."],
        "words": [{"start": i, "end": i + 0.5} for i in range(4)],
    }
    assert quote_evidence("say this", transcript, 4, 2) == {
        "quote": "Say this.",
        "start_seconds": 1.8,
        "end_seconds": 3.7,
    }
    assert quote_evidence("say this", transcript, 4, 3) is None
    assert quote_evidence("absent phrase", transcript, 4) is None
    assert quote_evidence("this", transcript, 4) is None


def test_partial_word_alignment_uses_wider_grounded_phrase_and_no_numeric_pause_claim():
    transcript = {
        "words": [{"start": 0, "end": 1}, {"start": 1, "end": 1}, {"start": 2, "end": 3}],
        "recognized_words": ["the", "river", "flows"],
    }
    evidence = quote_evidence("the river", transcript, 4)
    assert evidence["quote"] == "the river flows" and "no separate time span" in evidence["note"]
    assert evidence["start_seconds"] == 0 and evidence["end_seconds"] == 3.2
    metrics = timing_metrics(np.zeros(64000), [], 3, transcript["words"])
    feedback = timing_feedback(transcript, metrics, {}, 4)
    assert feedback["scope"] == "quality_and_timing"
    assert [item["code"] for item in feedback["insights"]] == ["observed_pace", "pause_timing_unavailable"]
    assert not any(item.get("evidence") for item in feedback["insights"])


def test_feedback_uses_actual_timings_and_a_playable_recognized_word_boundary():
    times = [{"start": 0.0, "end": 1.0}, {"start": 1.1, "end": 2.0}, {"start": 3.4, "end": 4.0}]
    transcript = {"words": times, "recognized_words": ["One", "small", "change."]}
    metrics = timing_metrics(np.zeros(16000 * 5), [], 3, times)
    feedback = timing_feedback(transcript, metrics, {"target_wpm": {"min": 120, "max": 150}}, 5)
    assert feedback["scope"] == "quality_and_timing"
    assert "45 words per minute" in feedback["insights"][0]["message"]
    longest = feedback["insights"][-1]
    assert "1.4 seconds" in longest["message"]
    assert longest["evidence"]["quote"] == "small … change."
    assert 0 <= longest["evidence"]["start_seconds"] < longest["evidence"]["end_seconds"] <= 5
    assert "smoother connections" in feedback["next_step"]


def test_unavailable_measurement_does_not_become_a_low_score_or_invented_observation():
    metrics = timing_metrics(np.zeros(16000), [], None, [])
    feedback = timing_feedback({}, metrics, {}, 1)
    assert feedback == {
        "version": "speech-timing-feedback-v1",
        "scope": "audio_quality_only",
        "insights": [],
        "next_step": None,
    }


@pytest.mark.parametrize("exercise_id,tag", [("E06", "pace"), ("E08", "pauses")])
def test_worker_publishes_timing_feedback_with_the_saved_take(
    client, app, worker, speech_file, exercise_id, tag
):
    from uuid import uuid4

    from app.content import generate_plan
    from app.db import Resource
    from tests.conftest import guest, post, upload

    gid = guest(client).json()["guest_id"]
    plan = generate_plan(
        {"id": str(uuid4())}, {"priorities": [{"tag": tag, "exercise_ids": [exercise_id]}]}, 1
    )
    item = next(i for i in plan["lessons"][0]["items"] if i["exercise_id"] == exercise_id)
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
    uploaded = upload(client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"]})
    assert uploaded.status_code == 202, uploaded.text
    assert worker.run_once()
    rid = uploaded.json()["recording"]["id"]
    checked = client.get("/api/v1/recordings/" + rid).json()
    assert checked["status"] == "completed"
    assert checked["speech_feedback"]["scope"] == "quality_and_timing"
    result = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid})
    assert result.status_code == 201, result.text
    feedback = result.json()["feedback"]
    assert feedback["version"] == "speech-timing-feedback-v1"
    assert feedback["insights"] == checked["speech_feedback"]["insights"]
    assert feedback["insights"][0]["code"] == "observed_pace"
    assert feedback["metrics"]["pause_ratio"]["available"]
    assert feedback["next_step"]


@pytest.mark.parametrize("exercise_id,tag", [("E06", "pace"), ("E08", "pauses")])
@pytest.mark.parametrize("intent", ["keep", "undecided"])
def test_recording_worker_respects_frozen_intent_in_local_timing_advice(
    client, app, worker, speech_file, exercise_id, tag, intent
):
    from uuid import uuid4

    from app.content import generate_plan
    from app.db import Resource
    from tests.conftest import guest, post, upload

    gid = guest(client).json()["guest_id"]
    plan = generate_plan(
        {"id": str(uuid4())}, {"priorities": [{"tag": tag, "exercise_ids": [exercise_id]}]}, 1
    )
    item = next(i for i in plan["lessons"][0]["items"] if i["exercise_id"] == exercise_id)
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
    first = upload(client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"]})
    assert worker.run_once()
    source = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": first.json()["recording"]["id"]},
    ).json()
    client.put(
        "/api/v1/exercise-attempts/" + source["id"] + "/reflection",
        json={"note": "Listen to this phrase.", "intent": intent},
    )
    repeated = upload(
        client,
        speech_file,
        {
            "purpose": "exercise",
            "plan_item_id": item["id"],
            "practice_only": "true",
            "based_on_attempt_id": source["id"],
        },
    )
    assert repeated.status_code == 202
    # Later reflection edits cannot change the instruction for the accepted take.
    client.put(
        "/api/v1/exercise-attempts/" + source["id"] + "/reflection",
        json={"note": "A later experiment.", "intent": "experiment"},
    )
    assert worker.run_once()
    saved = post(
        client,
        "/exercise-attempts",
        {
            "plan_item_id": item["id"],
            "recording_id": repeated.json()["recording"]["id"],
            "practice_only": True,
        },
    ).json()
    assert saved["practice_focus"]["intent"] == saved["feedback"]["practice_intent"] == intent
    assert saved["reward"]["notes"] == 0
    if intent == "keep":
        assert "wanted to keep" in saved["feedback"]["next_step"]
    else:
        assert "before deciding" in saved["feedback"]["next_step"]


def test_in_range_pace_does_not_introduce_an_unrelated_emphasis_correction():
    times = [{"start": 0, "end": 0.3}, {"start": 0.35, "end": 0.6}, {"start": 0.7, "end": 1.3}]
    metrics = timing_metrics(np.zeros(32000), [], 3, times)
    result = timing_feedback(
        {"words": times, "recognized_words": ["One", "clear", "thought"]},
        metrics,
        {"target_wpm": {"min": 120, "max": 150}},
        2,
    )
    assert 120 <= metrics["speaking_rate_wpm"]["value"] <= 150
    assert "keep it" in result["next_step"] and "emphasis" not in result["next_step"]
