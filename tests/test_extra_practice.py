"""Extra takes retain completion, ownership and idempotency without farming notes or time."""

import copy
from uuid import uuid4

from fastapi.testclient import TestClient

from app.content import generate_plan
from app.db import Resource
from tests.conftest import assessment, guest, post, upload


def setup_plan(client, app, kind="recording"):
    gid = guest(client).json()["guest_id"]
    plan = generate_plan(
        {"id": str(uuid4())}, {"priorities": [{"tag": "clarity", "exercise_ids": ["E03"]}]}, 1
    )
    item = next(
        i
        for i in plan["lessons"][0]["items"]
        if i["exercise_id"] == ("E03" if kind == "recording" else "E01")
    )
    plan["lessons"][0]["items"] = [
        item
    ]  # Isolate completion bookkeeping; browser tests use the full curriculum.
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
    return plan, item


def take(client, worker, speech_file, item, extra=False):
    fields = {"purpose": "exercise", "plan_item_id": item["id"]}
    if extra:
        fields["practice_only"] = "true"
    uploaded = upload(client, speech_file, fields)
    assert uploaded.status_code == 202, uploaded.text
    assert worker.run_once()
    job = client.get("/api/v1/jobs/" + uploaded.json()["job_id"]).json()
    assert job["status"] == "completed", job
    return uploaded.json()["recording"]["id"]


def test_repeat_records_feedback_and_time_but_keeps_original_completion_and_notes(
    client, app, worker, speech_file
):
    plan, item = setup_plan(client, app)
    rid = take(client, worker, speech_file, item)
    first = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid}).json()
    finished = client.put("/api/v1/progress/" + plan["lessons"][0]["id"], json={"status": "completed"})
    assert finished.status_code == 200
    before = client.get("/api/v1/me").json()
    with app.state.database.session() as db:
        frozen = copy.deepcopy(db.get(Resource, plan["id"]).data)
    extra_rid = take(client, worker, speech_file, item, extra=True)
    payload = {"plan_item_id": item["id"], "recording_id": extra_rid, "practice_only": True}
    key = str(uuid4())
    response = post(client, "/exercise-attempts", payload, key)
    assert response.status_code == 201, response.text
    extra = response.json()
    assert extra["practice_only"] is True and extra["status"] == "passed"
    assert extra["reward"] == {"notes": 0, "parts": []}
    assert extra["practice_seconds"] > 0
    assert post(client, "/exercise-attempts", payload, key).json() == extra
    duplicate = post(client, "/exercise-attempts", payload)
    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "recording_already_used"
    after = client.get("/api/v1/me").json()
    assert after["progress"]["notes_total"] == before["progress"]["notes_total"]
    assert (
        after["progress"]["practice_seconds_total"]
        == before["progress"]["practice_seconds_total"] + extra["practice_seconds"]
    )
    assert after["reassessment"] == before["reassessment"]
    assert client.get("/api/v1/today").json()["streak"] == finished.json()["streak"]
    with app.state.database.session() as db:
        assert db.get(Resource, plan["id"]).data == frozen
    page = client.get("/api/v1/exercise-attempts", params={"plan_item_id": item["id"], "limit": 1}).json()
    assert page["items"][0]["id"] == extra["id"] and page["next_cursor"]
    earlier = client.get(
        "/api/v1/exercise-attempts",
        params={"plan_item_id": item["id"], "limit": 1, "cursor": page["next_cursor"]},
    ).json()
    assert earlier["items"][0]["id"] == first["id"] and earlier["next_cursor"] is None


def test_extra_practice_cannot_unlock_pending_tasks_or_other_guests_data(client, app, worker, speech_file):
    _, item = setup_plan(client, app)
    not_done = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": str(uuid4()), "practice_only": True},
    )
    assert not_done.status_code == 409 and not_done.json()["error"]["code"] == "exercise_not_completed"
    forbidden_upload = upload(
        client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"], "practice_only": "true"}
    )
    assert forbidden_upload.status_code == 409
    rid = take(client, worker, speech_file, item)
    assert (
        post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid}).status_code
        == 201
    )
    mismatch = post(
        client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid, "practice_only": True}
    )
    assert mismatch.status_code == 422 and mismatch.json()["error"]["code"] == "practice_mode_mismatch"
    with TestClient(app) as other:
        guest(other)
        assert other.get("/api/v1/exercise-attempts", params={"plan_item_id": item["id"]}).status_code == 404
        denied = post(
            other,
            "/exercise-attempts",
            {"plan_item_id": item["id"], "recording_id": rid, "practice_only": True},
        )
        assert denied.status_code == 404


def test_failed_repeat_never_reopens_a_completed_exercise(client, app, worker, speech_file):
    plan, item = setup_plan(client, app)
    rid = take(client, worker, speech_file, item)
    first = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid}).json()
    with app.state.database.session.begin() as db:
        recording = copy.deepcopy(db.get(Resource, rid).data)
        recording.update(
            id=str(uuid4()),
            practice_only=True,
            status="needs_rerecord",
            quality={"issues": [{"code": "too_short", "message": "Try a longer take."}]},
        )
        db.add(
            Resource(
                id=recording["id"],
                guest_id=db.get(Resource, plan["id"]).guest_id,
                kind="recording",
                data=recording,
            )
        )
    result = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": recording["id"], "practice_only": True},
    )
    assert result.status_code == 201
    assert result.json()["status"] == "needs_retry" and result.json()["plan_item_status"] == "completed"
    with app.state.database.session() as db:
        saved = db.get(Resource, plan["id"]).data["lessons"][0]["items"][0]
        assert saved["status"] == "completed" and saved["latest_attempt_id"] == first["id"]


def test_untimed_repeat_limit_and_assessment_mode_validation(client, app, settings, speech_file):
    _, item = setup_plan(client, app, kind="self_confirmation")
    assert (
        post(client, "/exercise-attempts", {"plan_item_id": item["id"], "self_confirmed": True}).status_code
        == 201
    )
    settings.max_uploads_per_day = 1
    payload = {"plan_item_id": item["id"], "self_confirmed": True, "practice_only": True}
    extra = post(client, "/exercise-attempts", payload)
    assert extra.status_code == 201 and extra.json()["reward"]["notes"] == 0
    assert extra.json()["practice_seconds"] == 0
    assert post(client, "/exercise-attempts", payload).status_code == 429
    a = assessment(client).json()
    wrong_mode = upload(
        client,
        speech_file,
        {
            "purpose": "assessment",
            "assessment_id": a["id"],
            "task_id": a["tasks"][0]["id"],
            "practice_only": "true",
        },
    )
    assert wrong_mode.status_code == 422


def test_explicit_false_keeps_the_legacy_idempotency_fingerprint(client, app, worker, speech_file):
    _, item = setup_plan(client, app)
    key = str(uuid4())
    fields = {"purpose": "exercise", "plan_item_id": item["id"]}
    first_upload = upload(client, speech_file, fields, key)
    assert first_upload.status_code == 202
    second_upload = upload(client, speech_file, {**fields, "practice_only": "false"}, key)
    assert second_upload.json() == first_upload.json()
    assert worker.run_once()
    payload = {"plan_item_id": item["id"], "recording_id": first_upload.json()["recording"]["id"]}
    key = str(uuid4())
    first = post(client, "/exercise-attempts", payload, key)
    assert first.status_code == 201
    assert post(client, "/exercise-attempts", {**payload, "practice_only": False}, key).json() == first.json()


def test_archived_completed_item_accepts_uncredited_practice_without_reactivating_plan(
    client, app, worker, speech_file
):
    plan, item = setup_plan(client, app)
    rid = take(client, worker, speech_file, item)
    assert (
        post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid}).status_code
        == 201
    )
    with app.state.database.session.begin() as db:
        row = db.get(Resource, plan["id"])
        frozen = copy.deepcopy(row.data)
        frozen["status"] = "archived"
        row.data = frozen
    rid = take(client, worker, speech_file, item, extra=True)
    result = post(
        client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid, "practice_only": True}
    )
    assert result.status_code == 201 and result.json()["reward"]["notes"] == 0
    with app.state.database.session() as db:
        assert db.get(Resource, plan["id"]).data == frozen
