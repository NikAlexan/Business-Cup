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
