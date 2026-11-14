import copy
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db import Resource
from app.provider import ProviderFailure
from tests.conftest import assessment, guest, post, upload
from tests.test_extra_practice import setup_plan, take


def test_assessment_recovers_queued_and_failed_check_then_retries_the_same_recording(
    client, app, worker, settings, speech_file
):
    guest(client)
    a = assessment(client).json()
    task = a["tasks"][0]
    settings.job_max_attempts = 1
    uploaded = upload(
        client, speech_file, {"purpose": "assessment", "assessment_id": a["id"], "task_id": task["id"]}
    ).json()
    rid, jid = uploaded["recording"]["id"], uploaded["job_id"]
    path = "/api/v1/assessments/" + a["id"]
    state = client.get(path).json()["tasks"][0]["pending_take"]
    assert state["recording_id"] == rid and state["job_id"] == jid
    worker.failure(worker.claim(), ProviderFailure())
    failed = client.get(path).json()["tasks"][0]
    assert failed["pending_take"]["status"] == "failed" and "pending_recording_id" not in failed
    # Pre-pointer uploads remain recoverable through the owned quality job.
    with app.state.database.session.begin() as db:
        row = db.get(Resource, rid)
        data = copy.deepcopy(row.data)
        data.pop("check_job_id")
        row.data = data
    assert client.get(path).json()["tasks"][0]["pending_take"]["job_id"] == jid
    assert post(client, "/jobs/" + jid + "/retry", {}).status_code == 202
    assert worker.run_once()
    accepted = client.get(path).json()["tasks"][0]
    assert accepted["quality_status"] == "accepted" and accepted["recording_id"] == rid
    assert accepted["pending_take"] is None
    with TestClient(app) as other:
        guest(other)
        assert other.get(path).status_code == 404


def complete_item(client, app, worker, speech_file):
    _, item = setup_plan(client, app)
    rid = take(client, worker, speech_file, item)
    assert (
        post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid}).status_code
        == 201
    )
    return item


def test_cancellation_before_upload_prevents_a_late_extra_take(client, app, worker, speech_file):
    item = complete_item(client, app, worker, speech_file)
    key = str(uuid4())
    path = "/api/v1/recording-uploads/" + key + "/cancellation"
    canceled = client.put(path, json={"plan_item_id": item["id"]})
    assert canceled.status_code == 200, canceled.text
    assert client.put(path, json={"plan_item_id": item["id"]}).json() == canceled.json()
    late = upload(
        client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"], "practice_only": "true"}, key
    )
    assert late.status_code == 409 and late.json()["error"]["code"] == "upload_canceled"
    assert client.get("/api/v1/plan-items/" + item["id"]).json()["pending_take"] is None
    assert not worker.run_once()


def test_cancellation_after_acceptance_marks_the_owned_upload_and_survives_worker_publication(
    client, app, worker, speech_file
):
    item = complete_item(client, app, worker, speech_file)
    key = str(uuid4())
    uploaded = upload(
        client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"], "practice_only": "true"}, key
    ).json()
    rid = uploaded["recording"]["id"]
    claim = worker.claim()
    snapshot = worker.snapshot(claim, rid, "recording")
    path = "/api/v1/recording-uploads/" + key + "/cancellation"
    result = client.put(path, json={"plan_item_id": item["id"]})
    assert result.status_code == 200 and result.json()["recording_id"] == rid
    worker.publish_recording(claim, snapshot, {"status": "accepted", "issues": [], "duration_seconds": 4})
    assert client.get("/api/v1/plan-items/" + item["id"]).json()["pending_take"] is None
    assert (
        post(
            client,
            "/exercise-attempts",
            {"plan_item_id": item["id"], "recording_id": rid, "practice_only": True},
        ).status_code
        == 404
    )
    with TestClient(app) as other:
        guest(other)
        assert other.put(path, json={"plan_item_id": item["id"]}).status_code == 404


def test_upload_cancellation_cannot_discard_a_saved_attempt(client, app, worker, speech_file):
    item = complete_item(client, app, worker, speech_file)
    key = str(uuid4())
    uploaded = upload(
        client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"], "practice_only": "true"}, key
    ).json()
    assert worker.run_once()
    assert (
        post(
            client,
            "/exercise-attempts",
            {"plan_item_id": item["id"], "recording_id": uploaded["recording"]["id"], "practice_only": True},
        ).status_code
        == 201
    )
    before = client.get("/api/v1/me").json()["progress"]
    response = client.put(
        "/api/v1/recording-uploads/" + key + "/cancellation", json={"plan_item_id": item["id"]}
    )
    assert response.status_code == 409 and response.json()["error"]["code"] == "recording_already_used"
    assert client.get("/api/v1/me").json()["progress"] == before
