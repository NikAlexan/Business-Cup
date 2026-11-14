import copy
import time
from datetime import timedelta
from uuid import uuid4

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Idempotency, Job, Resource, iso, utcnow
from app.provider import ProviderFailure
from app.worker import WorkCancelled, Worker
from tests.conftest import assessment, complete_assessment, guest, post, upload


def test_health_validation_and_cookie(client):
    assert client.get("/health/live").status_code == 200
    assert client.get("/health/ready").status_code == 200
    assert client.get("/api/v1/me").status_code == 401
    denied = post(
        client, "/guest-session", {"consent": {"audio_processing": False, "policy_version": "2026-11-14"}}
    )
    assert denied.status_code == 422 and denied.json()["error"]["code"] == "consent_required"
    r = guest(client)
    assert r.status_code == 201 and "HttpOnly" in r.headers["set-cookie"]
    assert "guest_session" in client.cookies
    assert guest(client).status_code == 200
    assert client.get("/api/v1/me").json()["onboarding_status"] == "needs_assessment"
    assert client.patch("/api/v1/preferences", json={"timezone": "Not/AZone"}).status_code == 422
    assert client.patch("/api/v1/preferences", json={"goal": None}).status_code == 422
    assert (
        client.patch("/api/v1/preferences", json={"goal": "expressive_voice"}).json()["goal"]
        == "expressive_voice"
    )
    assert client.get("/api/v1/me").json()["preferences"]["goal"] == "expressive_voice"
    csrf = client.patch(
        "/api/v1/preferences", json={"goal": "clear_speech"}, headers={"Origin": "https://evil.example"}
    )
    assert csrf.status_code == 403
    assert client.get("/api/v1/progress").json()["summary"]["completed_lessons_all_time"] == 0


def test_idempotency_and_session_retry_without_cookie(app, client):
    k = str(uuid4())
    first = guest(client, k)
    client.cookies.clear()
    second = guest(client, k)
    assert first.json() == second.json()
    k = str(uuid4())
    first = post(client, "/assessments", {"kind": "initial", "recording_conditions": {}}, k)
    second = post(client, "/assessments", {"kind": "initial", "recording_conditions": {}}, k)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    wrong = post(client, "/assessments", {"kind": "reassessment", "recording_conditions": {}}, k)
    assert wrong.status_code == 409 and wrong.json()["error"]["code"] == "idempotency_conflict"
    assert assessment(client).status_code == 409
    assert len(client.get("/api/v1/assessments").json()["items"]) == 1


def test_ownership_upload_retry_and_delete(app, client, worker, speech_file, settings):
    gid = guest(client).json()["guest_id"]
    a = assessment(client).json()
    fields = {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]}
    k = str(uuid4())
    r = upload(client, speech_file, fields, k)
    assert r.status_code == 202, r.text
    repeat = upload(client, speech_file, fields, k)
    assert repeat.json() == r.json()
    assert upload(client, speech_file, fields).status_code == 409
    rec, job = r.json()["recording"]["id"], r.json()["job_id"]
    other = TestClient(app)
    guest(other)
    for path in (
        "/recordings/" + rec,
        "/recordings/" + rec + "/audio",
        "/jobs/" + job,
        "/assessments/" + a["id"],
    ):
        assert other.get("/api/v1" + path).status_code == 404
    audio = client.get("/api/v1/recordings/" + rec + "/audio", headers={"Range": "bytes=0-15"})
    assert audio.status_code == 206 and len(audio.content) == 16
    claim = worker.claim()
    assert claim is not None
    assert client.delete("/api/v1/guest-data").status_code == 204
    assert not (settings.audio_data / gid).exists()
    assert client.get("/api/v1/me").status_code == 401
    try:
        worker.stage(claim, "quality_check")
        assert False, "Deleted work must not publish"
    except WorkCancelled:
        pass
    with app.state.database.session() as db:
        for cls in (Resource, Job, Idempotency):
            assert db.scalar(select(func.count()).select_from(cls).where(cls.guest_id == gid)) == 0


def test_silence_replacement_and_submit_not_ready(client, worker, speech_file, tmp_path):
    guest(client)
    a = assessment(client).json()
    fields = {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]}
    silence = tmp_path / "silence.wav"
    sf.write(silence, np.zeros(16000 * 6), 16000)
    bad = upload(client, silence, fields).json()
    worker.run_once()
    assert client.get("/api/v1/jobs/" + bad["job_id"]).json()["status"] == "needs_rerecord"
    assert post(client, "/assessments/" + a["id"] + "/submit", {}).status_code == 409
    good = upload(client, speech_file, fields)
    assert good.status_code == 202
    worker.run_once()
    a = client.get("/api/v1/assessments/" + a["id"]).json()
    assert a["tasks"][0]["recording_id"] == good.json()["recording"]["id"]
    assert a["tasks"][0]["quality_status"] == "accepted"
    assert client.get("/api/v1/me").json()["reassessment"]["next_available_on"] is None


def test_full_flow_plan_attempts_streak_and_reassessment(client, worker, speech_file, app):
    guest(client)
    a = complete_assessment(client, worker, speech_file)
    assert a["report"]["priorities"] and a["measurements"]["f0_median_hz"]["available"]
    assert a["comparison"] is None
    plan = client.get("/api/v1/plan").json()
    assert len(plan["lessons"]) == 14
    assert all(
        i["exercise_id"] in {e["id"] for e in client.get("/api/v1/exercises").json()["items"]}
        for lsn in plan["lessons"]
        for i in lsn["items"]
    )
    lesson = client.get("/api/v1/today").json()["lesson"]
    lid = lesson["id"]
    assert client.put("/api/v1/progress/" + lid, json={"status": "completed"}).status_code == 409
    warmup = lesson["items"][0]
    short = post(client, "/exercise-attempts", {"plan_item_id": warmup["id"], "elapsed_seconds": 1})
    assert short.json()["status"] == "needs_retry"
    for item in lesson["items"]:
        if item["task"]["verification"]["type"] == "timer":
            payload = {"plan_item_id": item["id"], "elapsed_seconds": 60}
        else:
            r = upload(client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"]})
            assert r.status_code == 202, r.text
            worker.run_once()
            payload = {"plan_item_id": item["id"], "recording_id": r.json()["recording"]["id"]}
        attempt = post(client, "/exercise-attempts", payload)
        assert attempt.status_code == 201 and attempt.json()["status"] == "passed", attempt.text
    completed = client.put("/api/v1/progress/" + lid, json={"status": "completed"})
    assert completed.status_code == 200, completed.text
    assert completed.json()["streak"]["current_days"] == 1
    assert client.put("/api/v1/progress/" + lid, json={"status": "completed"}).json() == completed.json()
    assert client.get("/api/v1/today").json()["daily_status"] == "completed"
    assert client.get("/api/v1/progress").json()["summary"]["completed_lessons_all_time"] == 1
    assert assessment(client, "reassessment").status_code == 409
    assert assessment(client, "reassessment", demo=True).status_code == 403
    # Move the completed assessment back 14 days to exercise the true date gate.
    with app.state.database.session.begin() as db:
        row = db.get(Resource, a["id"])
        value = copy.deepcopy(row.data)
        value["completed_at"] = iso(utcnow() - timedelta(days=14))
        row.data = value
    repeated = complete_assessment(client, worker, speech_file, "reassessment")
    assert repeated["comparison"]["baseline_assessment_id"] == a["id"]
    assert repeated["plan_id"] != plan["id"]
    assert client.get("/api/v1/plans/" + plan["id"]).json()["status"] == "archived"
    assert client.get("/api/v1/progress").json()["summary"]["completed_lessons_all_time"] == 1
    # A fresh reassessment plan must not permit a second lesson on the same date.
    today_after = client.get("/api/v1/today").json()
    assert today_after["daily_status"] == "completed"
    assert today_after["plan_id"] == plan["id"]
    assert client.get("/api/v1/plan").json()["lessons"][0]["status"] == "locked"


def test_provider_missing_key_is_explicit(client, settings, app, worker, speech_file):
    from app.provider import OpenAIAudioProvider

    guest(client)
    a = assessment(client).json()
    for t in a["tasks"]:
        upload(client, speech_file, {"purpose": "assessment", "assessment_id": a["id"], "task_id": t["id"]})
        worker.run_once()
    r = post(client, "/assessments/" + a["id"] + "/submit", {}).json()
    Worker(settings, app.state.database, OpenAIAudioProvider).run_once()
    j = client.get("/api/v1/jobs/" + r["job_id"]).json()
    assert j["status"] == "failed" and j["error"]["code"] == "analysis_not_configured"
    assert j["retryable"] is False
    assert client.get("/api/v1/plan").status_code == 404


def test_expired_worker_lease_can_be_reclaimed(client, worker, speech_file, app):
    guest(client)
    a = assessment(client).json()
    r = upload(
        client,
        speech_file,
        {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]},
    ).json()
    old = worker.claim()
    with app.state.database.session.begin() as db:
        db.get(Job, r["job_id"]).lease_until = time.time() - 1
    assert worker.run_once()
    assert client.get("/api/v1/jobs/" + r["job_id"]).json()["status"] == "completed"
    with app.state.database.session.begin() as db:
        try:
            worker.locked(db, old)
            assert False
        except WorkCancelled:
            pass


def test_upload_limits_and_mime_sniffing(client, app, settings, speech_file):
    guest(client)
    a = assessment(client).json()
    fields = {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]}
    r = client.post(
        "/api/v1/recordings",
        data=fields,
        files={"file": ("attack.wav", b"<html>not audio</html>", "audio/wav")},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 415
    r = client.post(
        "/api/v1/recordings",
        data=fields,
        files={"file": ("empty.wav", b"", "audio/wav")},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 415
    settings.max_file_bytes = 100
    assert upload(client, speech_file, fields).status_code == 413


def test_concurrent_submit_creates_one_job(client, worker, speech_file, app):
    from concurrent.futures import ThreadPoolExecutor

    from fastapi.testclient import TestClient

    guest(client)
    a = assessment(client).json()
    for t in a["tasks"]:
        upload(client, speech_file, {"purpose": "assessment", "assessment_id": a["id"], "task_id": t["id"]})
        worker.run_once()
    cookie = dict(client.cookies)

    def submit_one(_):
        other = TestClient(app, cookies=cookie)
        return post(other, "/assessments/" + a["id"] + "/submit", {})

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit_one, range(2)))
    assert all(r.status_code == 202 for r in responses)
    assert responses[0].json()["job_id"] == responses[1].json()["job_id"]


def test_failed_job_retry_preserves_id_and_is_bounded(client, worker, speech_file, app):
    guest(client)
    a = assessment(client).json()
    r = upload(
        client,
        speech_file,
        {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]},
    ).json()
    claim = worker.claim()
    with app.state.database.session.begin() as db:
        row = db.get(Job, r["job_id"])
        d = copy.deepcopy(row.data)
        d["attempt_count"] = d["max_attempts"]
        row.data = d
    worker.failure(claim, ProviderFailure())
    failed = client.get("/api/v1/jobs/" + r["job_id"]).json()
    assert failed["status"] == "failed" and failed["retryable"]
    retried = post(client, "/jobs/" + r["job_id"] + "/retry", {})
    assert retried.status_code == 202 and retried.json()["job_id"] == r["job_id"]
    worker.run_once()
    assert client.get("/api/v1/jobs/" + r["job_id"]).json()["status"] == "completed"
    assert post(client, "/jobs/" + r["job_id"] + "/retry", {}).status_code == 409


def test_expired_final_lease_marks_recording_failed(client, worker, speech_file, app):
    guest(client)
    a = assessment(client).json()
    r = upload(
        client,
        speech_file,
        {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]},
    ).json()
    worker.claim()
    with app.state.database.session.begin() as db:
        row = db.get(Job, r["job_id"])
        data = copy.deepcopy(row.data)
        data["attempt_count"] = data["max_attempts"]
        row.data = data
        row.lease_until = time.time() - 1
    assert worker.run_once()
    j = client.get("/api/v1/jobs/" + r["job_id"]).json()
    assert j["status"] == "failed" and j["error"]["code"] == "worker_retry_exhausted"
    assert client.get("/api/v1/recordings/" + r["recording"]["id"]).json()["status"] == "failed"


def test_calendar_gate_uses_local_date_across_dst(client, app, monkeypatch):
    from datetime import UTC, datetime

    import app.service as service_module

    guest(client)
    a = assessment(client).json()
    with app.state.database.session.begin() as db:
        row = db.get(Resource, a["id"])
        value = copy.deepcopy(row.data)
        value.update(status="completed", completed_at="2026-03-01T16:00:00Z")
        row.data = value
    # 14 local calendar dates have elapsed, although fewer than 14*24 hours have passed.
    monkeypatch.setattr(service_module, "utcnow", lambda: datetime(2026, 3, 15, 4, 0, tzinfo=UTC))
    assert client.get("/api/v1/me").json()["reassessment"]["available"] is True
    assert assessment(client, "reassessment").status_code == 201


def test_global_budget_survives_guest_deletion(client, worker, speech_file, settings):
    settings.max_total_uploads_per_day = 1
    guest(client)
    a = assessment(client).json()
    assert (
        upload(
            client,
            speech_file,
            {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]},
        ).status_code
        == 202
    )
    assert client.delete("/api/v1/guest-data").status_code == 204
    guest(client)
    a = assessment(client).json()
    rejected = upload(
        client,
        speech_file,
        {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]},
    )
    assert rejected.status_code == 429


def test_pace_exercise_uses_verified_transcription(client, worker, speech_file, app):
    from app.content import generate_plan
    from tests.conftest import FakeProvider

    g = guest(client).json()
    report = FakeProvider(None).report([], {}, {}, None)
    report["priorities"] = [{"tag": "pace", "reason": "Comfortable pacing.", "exercise_ids": ["E06", "E07"]}]
    p = generate_plan({"id": str(uuid4())}, report, 1)
    with app.state.database.session.begin() as db:
        db.add(Resource(id=p["id"], guest_id=g["guest_id"], kind="plan", data=p))
    item = next(i for i in p["lessons"][0]["items"] if i["exercise_id"] == "E06")
    r = upload(client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"]})
    assert r.status_code == 202
    worker.run_once()
    j = client.get("/api/v1/jobs/" + r.json()["job_id"]).json()
    assert j["status"] == "completed", j
    metric = j["result"]["measurements"]["speaking_rate_wpm"]
    assert metric["available"] and metric["value"] > 0
    # Verify both outcomes using narrow/wide target ranges, without another paid or audio operation.
    with app.state.database.session.begin() as db:
        row = db.get(Resource, p["id"])
        value = copy.deepcopy(row.data)
        target = next(i for i in value["lessons"][0]["items"] if i["id"] == item["id"])
        target["task"]["verification"]["target_wpm"] = {"min": 1, "max": 2}
        row.data = value
    payload = {"plan_item_id": item["id"], "recording_id": r.json()["recording"]["id"]}
    attempt = post(client, "/exercise-attempts", payload)
    assert attempt.json()["status"] == "needs_retry"
    with app.state.database.session.begin() as db:
        row = db.get(Resource, p["id"])
        value = copy.deepcopy(row.data)
        target = next(i for i in value["lessons"][0]["items"] if i["id"] == item["id"])
        target["task"]["verification"]["target_wpm"] = {"min": 1, "max": 1000}
        row.data = value
    assert post(client, "/exercise-attempts", payload).json()["status"] == "passed"


def test_invalid_audio_range_uses_json_error(client, speech_file):
    guest(client)
    a = assessment(client).json()
    r = upload(
        client,
        speech_file,
        {"purpose": "assessment", "assessment_id": a["id"], "task_id": a["tasks"][0]["id"]},
    ).json()
    response = client.get(
        "/api/v1/recordings/" + r["recording"]["id"] + "/audio", headers={"Range": "bytes=999999999-"}
    )
    assert response.status_code == 416
    assert response.json()["error"]["code"] == "range_not_satisfiable"


def test_demo_override_requires_enabled_mode_and_is_auditable(client, app, settings):
    settings.demo_mode = True
    guest(client)
    a = assessment(client).json()
    with app.state.database.session.begin() as db:
        row = db.get(Resource, a["id"])
        value = copy.deepcopy(row.data)
        value.update(status="completed", completed_at=iso())
        row.data = value
    response = assessment(client, "reassessment", demo=True)
    assert response.status_code == 201
    assert response.json()["demo_override_used"] is True
    assert client.get("/api/v1/me").json()["demo_mode"] is True


def test_rewards_follow_completed_practice(client, worker, speech_file):
    guest(client)
    complete_assessment(client, worker, speech_file)
    lesson = client.get("/api/v1/today").json()["lesson"]
    expected = {
        i["id"]: (2 if i["exercise_id"] == "E01" else 3) + (i["task"]["verification"]["type"] == "recording")
        for i in lesson["items"]
    }
    assert {i["id"]: i["notes_available"] for i in lesson["items"]} == expected
    assert client.get("/api/v1/plan").json()["lessons"][0]["items"][0]["notes_available"] == 2

    warmup = lesson["items"][0]
    short = post(client, "/exercise-attempts", {"plan_item_id": warmup["id"], "elapsed_seconds": 1}).json()
    assert short["reward"] == {"notes": 0, "parts": []} and short["practice_seconds"] == 0

    results = {}
    for item in lesson["items"]:
        key = str(uuid4())
        if item["task"]["verification"]["type"] == "timer":
            payload = {"plan_item_id": item["id"], "elapsed_seconds": 60}
        else:
            r = upload(client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"]})
            worker.run_once()
            payload = {"plan_item_id": item["id"], "recording_id": r.json()["recording"]["id"]}
        first = post(client, "/exercise-attempts", payload, key=key)
        assert first.status_code == 201, first.text
        assert post(client, "/exercise-attempts", payload, key=key).json() == first.json()
        results[item["id"]] = (item, first.json())
    assert results[warmup["id"]][1]["reward"] == {
        "notes": 2,
        "parts": [{"notes": 2, "reason": "exercise_completed"}],
    }
    recorded = [a for i, a in results.values() if i["task"]["verification"]["type"] == "recording"]
    assert recorded and recorded[0]["reward"]["parts"] == [
        {"notes": 3, "reason": "exercise_completed"},
        {"notes": 1, "reason": "quality_bonus"},
    ]

    done = client.put("/api/v1/progress/" + lesson["id"], json={"status": "completed"}).json()
    assert done["session_reward"]["notes"] == sum(expected.values())
    assert done["session_reward"]["practice_seconds"] > 60
    again = client.put("/api/v1/progress/" + lesson["id"], json={"status": "completed"}).json()
    assert again["session_reward"] == done["session_reward"]
    me = client.get("/api/v1/me").json()["progress"]
    assert me["notes_total"] == sum(expected.values())
    assert me["practice_seconds_total"] == done["session_reward"]["practice_seconds"]
    assert client.get("/api/v1/progress").json()["summary"]["notes_total"] == me["notes_total"]

    assert client.delete("/api/v1/guest-data").status_code == 204
    guest(client)
    assert client.get("/api/v1/me").json()["progress"]["notes_total"] == 0
