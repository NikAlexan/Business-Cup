import numpy as np
import pytest

from app.audio import timing_metrics
from app.coaching import timing_feedback


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
