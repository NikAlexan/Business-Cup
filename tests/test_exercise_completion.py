"""Completion reflects practice and usable audio, not hitting a stopwatch or pace target."""

from uuid import uuid4

import pytest

from app.content import generate_plan
from app.db import Resource
from tests.conftest import guest, post


@pytest.mark.parametrize(
    "rate,expected", [(100, "pace_outside_target"), (135, None), (None, "measurement_unavailable")]
)
def test_pace_is_coaching_not_completion_gate(client, app, rate, expected):
    gid = guest(client).json()["guest_id"]
    plan = generate_plan(
        {"id": str(uuid4())},
        {"priorities": [{"tag": "pace", "exercise_ids": ["E06"]}]},
        1,
    )
    item = next(i for i in plan["lessons"][0]["items"] if i["exercise_id"] == "E06")
    rec_id = str(uuid4())
    recording = {
        "id": rec_id,
        "purpose": "exercise",
        "plan_item_id": item["id"],
        "status": "completed",
        "duration_seconds": 22.5,
        "quality": {"issues": []},
        "measurements": {"speaking_rate_wpm": {"available": rate is not None, "value": rate}},
    }
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
        db.add(Resource(id=rec_id, guest_id=gid, kind="recording", data=recording))
    response = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rec_id})
    assert response.status_code == 201, response.text
    attempt = response.json()
    assert attempt["status"] == "passed"
    assert attempt["feedback"]["issues"] == []
    assert [x["code"] for x in attempt["feedback"]["coaching"]] == ([expected] if expected else [])
    assert attempt["practice_seconds"] == 22


def test_legacy_timer_does_not_require_waiting(client, app):
    gid = guest(client).json()["guest_id"]
    plan = generate_plan(
        {"id": str(uuid4())}, {"priorities": [{"tag": "clarity", "exercise_ids": ["E03"]}]}, 1
    )
    item = plan["lessons"][0]["items"][0]
    item["task"]["verification"].update(type="timer", min_elapsed_seconds=45)
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
    response = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "elapsed_seconds": 5})
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "passed"
    assert response.json()["practice_seconds"] == 5


@pytest.mark.parametrize("failure_at", ["construction", "transcription"])
def test_optional_transcription_failure_preserves_accepted_take(
    client, app, settings, speech_file, failure_at, monkeypatch
):
    from app.audio import QUALITY_RULES
    from app.content import EXERCISES
    from app.provider import ProviderFailure
    from app.worker import Worker
    from tests.conftest import FakeProvider, upload

    class UnavailableProvider(FakeProvider):
        def __init__(self, settings):
            if failure_at == "construction":
                raise ProviderFailure("analysis_not_configured", False)
            super().__init__(settings)

        def transcribe(self, signal, text):
            raise ProviderFailure("analysis_provider_rate_limited", True)

    gid = guest(client).json()["guest_id"]
    plan = generate_plan({"id": str(uuid4())}, {"priorities": [{"tag": "pace", "exercise_ids": ["E06"]}]}, 1)
    item = next(i for i in plan["lessons"][0]["items"] if i["exercise_id"] == "E06")
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
    # Issued snapshots must still work after an exercise is removed from the live catalog.
    monkeypatch.delitem(EXERCISES, "E06")
    monkeypatch.setitem(QUALITY_RULES, "exercise_min_speech_seconds", 1000)
    uploaded = upload(client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"]})
    assert uploaded.status_code == 202, uploaded.text
    worker = Worker(settings, app.state.database, provider_factory=UnavailableProvider)
    assert worker.run_once()
    job = client.get("/api/v1/jobs/" + uploaded.json()["job_id"]).json()
    assert job["status"] == "completed", job
    assert job["result"]["quality"]["status"] == "accepted"
    pace = job["result"]["measurements"]["speaking_rate_wpm"]
    assert pace["available"] is False and pace["value"] is None
    assert pace["unavailable_reason"] == "transcription_provider_unavailable"
    attempt = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": uploaded.json()["recording"]["id"]},
    )
    assert attempt.status_code == 201 and attempt.json()["status"] == "passed", attempt.text


def test_self_confirmation_does_not_count_estimate_as_actual_time(client, app):
    gid = guest(client).json()["guest_id"]
    plan = generate_plan({"id": str(uuid4())}, {"priorities": []}, 1)
    item = plan["lessons"][0]["items"][0]
    assert item["estimated_duration_seconds"] > 0
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
    attempt = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "self_confirmed": True})
    assert attempt.status_code == 201
    assert attempt.json()["practice_seconds"] == 0
    assert attempt.json()["practice_seconds_source"] == "unknown"
    assert attempt.json()["reward"]["notes"] > 0


def test_legacy_self_confirmation_estimates_are_excluded_from_actual_totals(client, app):
    gid = guest(client).json()["guest_id"]
    with app.state.database.session.begin() as db:
        db.add(
            Resource(
                guest_id=gid,
                kind="attempt",
                data={
                    "status": "passed",
                    "verification_type": "self_confirmation",
                    "practice_seconds": 60,
                    "reward": {"notes": 2},
                },
            )
        )
    progress = client.get("/api/v1/me").json()["progress"]
    assert progress["practice_seconds_total"] == 0
    assert progress["notes_total"] == 2
