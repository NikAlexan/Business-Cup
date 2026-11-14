import copy
from uuid import uuid4

from fastapi.testclient import TestClient

from tests.conftest import guest, post, upload
from tests.test_extra_practice import setup_plan, take


def test_accepted_upload_is_discoverable_until_its_attempt_is_saved(client, app, worker, speech_file):
    _, item = setup_plan(client, app)
    uploaded = upload(client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"]})
    state = client.get("/api/v1/plan-items/" + item["id"]).json()
    assert state["pending_take"]["job_id"] == uploaded.json()["job_id"]
    assert state["pending_take"]["recording_id"] == uploaded.json()["recording"]["id"]
    assert worker.run_once()
    resumed = client.get("/api/v1/plan-items/" + item["id"]).json()
    assert resumed["pending_take"]["status"] == "completed"
    result = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": resumed["pending_take"]["recording_id"]},
    )
    assert result.status_code == 201, result.text
    complete = client.get("/api/v1/plan-items/" + item["id"]).json()
    assert complete["pending_take"] is None and complete["item"]["status"] == "completed"
    with TestClient(app) as other:
        guest(other)
        assert other.get("/api/v1/plan-items/" + item["id"]).status_code == 404


def test_dismissal_survives_worker_publication_and_cannot_be_submitted(client, app, worker, speech_file):
    _, item = setup_plan(client, app)
    uploaded = upload(client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"]}).json()
    claim = worker.claim()
    snapshot = worker.snapshot(claim, uploaded["recording"]["id"], "recording")
    path = "/api/v1/recordings/" + snapshot["id"] + "/dismiss"
    dismissed = client.put(path, json={})
    assert dismissed.status_code == 200
    assert client.put(path, json={}).json() == dismissed.json()
    worker.publish_recording(claim, snapshot, {"status": "accepted", "issues": [], "duration_seconds": 4})
    assert (
        client.get("/api/v1/recordings/" + snapshot["id"]).json()["dismissed_at"]
        == dismissed.json()["dismissed_at"]
    )
    assert client.get("/api/v1/plan-items/" + item["id"]).json()["pending_take"] is None
    assert (
        post(
            client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": snapshot["id"]}
        ).status_code
        == 404
    )


def test_archived_item_and_pending_extra_take_are_recoverable(client, app, worker, speech_file):
    from app.db import Resource

    plan, item = setup_plan(client, app)
    rid = take(client, worker, speech_file, item)
    first = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid}).json()
    with app.state.database.session.begin() as db:
        row = db.get(Resource, plan["id"])
        archived = copy.deepcopy(row.data)
        archived["status"] = "archived"
        row.data = archived
    uploaded = upload(
        client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"], "practice_only": "true"}
    ).json()
    state = client.get("/api/v1/plan-items/" + item["id"]).json()
    assert state["plan_status"] == "archived"
    assert state["pending_take"]["practice_only"] is True
    assert state["pending_take"]["recording_id"] == uploaded["recording"]["id"]
    assert client.put("/api/v1/recordings/" + rid + "/dismiss", json={}).status_code == 409
    assert state["item"]["latest_attempt_id"] == first["id"]


def test_reflection_is_owned_idempotent_and_frozen_with_the_next_take(client, app, worker, speech_file):
    _, item = setup_plan(client, app)
    rid = take(client, worker, speech_file, item)
    first = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid}).json()
    path = "/api/v1/exercise-attempts/" + first["id"] + "/reflection"
    saved = client.put(path, json={"note": "  Let the final word land.  "})
    assert saved.status_code == 200 and saved.json()["reflection"]["note"] == "Let the final word land."
    assert client.put(path, json={"note": "Let the final word land."}).json() == saved.json()
    assert client.put(path, json={"note": "x" * 501}).status_code == 422
    fields = {
        "purpose": "exercise",
        "plan_item_id": item["id"],
        "practice_only": "true",
        "based_on_attempt_id": first["id"],
    }
    extra = upload(client, speech_file, fields).json()
    state = client.get("/api/v1/plan-items/" + item["id"]).json()
    assert state["pending_take"]["practice_focus"]["note"] == "Let the final word land."
    assert client.put(path, json={"note": "A different future focus."}).status_code == 200
    assert worker.run_once()
    response = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": extra["recording"]["id"], "practice_only": True},
    )
    assert response.status_code == 201, response.text
    assert response.json()["practice_focus"] == {
        "attempt_id": first["id"],
        "note": "Let the final word land.",
    }
    with TestClient(app) as other:
        guest(other)
        assert other.put(path, json={"note": "Cannot edit this."}).status_code == 404
    history = client.get("/api/v1/exercise-attempts", params={"plan_item_id": item["id"]}).json()["items"]
    assert (
        next(t for t in history if t["id"] == first["id"])["reflection"]["note"]
        == "A different future focus."
    )


def test_focus_cannot_reference_another_guests_attempt(client, app, worker, speech_file):
    _, item = setup_plan(client, app)
    rid = take(client, worker, speech_file, item)
    post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid})
    result = upload(
        client,
        speech_file,
        {
            "purpose": "exercise",
            "plan_item_id": item["id"],
            "practice_only": "true",
            "based_on_attempt_id": str(uuid4()),
        },
    )
    assert result.status_code == 404
