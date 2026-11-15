"""Conditional reflection saves preserve current decisions, drafts and immutable old receipts."""

from uuid import uuid4

from fastapi.testclient import TestClient

from tests.conftest import guest, post
from tests.test_extra_practice import setup_plan, take


def source_take(client, app, worker, speech_file):
    _, item = setup_plan(client, app)
    recording = take(client, worker, speech_file, item)
    result = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": recording})
    assert result.status_code == 201
    return result.json()


def test_stale_note_save_cannot_revert_a_newer_decision_and_a_lost_response_can_replay(
    client, app, worker, speech_file
):
    source = source_take(client, app, worker, speech_file)
    path = "/api/v1/exercise-attempts/" + source["id"] + "/reflection"
    before = client.get("/api/v1/me").json()["progress"]
    payload = {"note": "Listen to this phrase first.", "intent": "undecided", "expected_revision": 0}
    first = client.put(path, json=payload)
    assert first.status_code == 200
    assert first.json()["reflection"]["revision"] == 1
    assert client.put(path, json=payload).json() == first.json()
    stale = client.put(
        path, json={"note": "My draft from an older page.", "intent": "experiment", "expected_revision": 0}
    )
    assert stale.status_code == 409
    current = stale.json()["error"]["details"]["current_attempt"]
    assert current["reflection"] == first.json()["reflection"]
    assert (
        client.get("/api/v1/exercise-attempts/" + source["id"]).json()["reflection"]
        == first.json()["reflection"]
    )
    # Editing only the note never changes the current saved decision, including legacy unconditional PUTs.
    merged = client.put(path, json={"note": "My reviewed note.", "expected_revision": 1}).json()
    assert merged["reflection"]["intent"] == "undecided" and merged["reflection"]["revision"] == 2
    legacy = client.put(path, json={"note": "An older client can still save a note."}).json()
    assert legacy["reflection"]["intent"] == "undecided" and legacy["reflection"]["revision"] == 3
    assert client.get("/api/v1/me").json()["progress"] == before
    with TestClient(app) as other:
        guest(other)
        foreign = other.put(path, json=payload)
        assert foreign.status_code == 404
        assert "current_attempt" not in foreign.json()["error"].get("details", {})


def test_stale_story_focus_save_rolls_back_and_old_receipt_cannot_reactivate_its_pointer(
    client, app, worker, speech_file
):
    source = source_take(client, app, worker, speech_file)
    payload = {
        "source_attempt_id": source["id"],
        "note": "Keep these endings comfortable.",
        "intent": "keep",
        "expected_reflection_revision": 0,
    }
    key = str(uuid4())
    first = post(client, "/practice-focus", payload, key)
    assert first.status_code == 201
    fid = first.json()["focus"]["id"]
    source_path = "/api/v1/exercise-attempts/" + source["id"]
    newer = client.put(
        source_path + "/reflection",
        json={"note": "Listen first.", "intent": "undecided", "expected_revision": 1},
    ).json()
    assert newer["reflection"]["revision"] == 2
    before = client.get("/api/v1/me").json()["progress"]
    refused = post(
        client,
        "/practice-focus",
        {**payload, "note": "A stale draft.", "intent": "experiment", "expected_reflection_revision": 1},
    )
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "reflection_changed"
    assert client.get("/api/v1/practice-focus").json()["focus"]["id"] == fid
    assert client.get(source_path).json()["reflection"] == newer["reflection"]
    second = post(
        client,
        "/practice-focus",
        {**payload, "note": "A deliberately reviewed choice.", "expected_reflection_revision": 2},
    ).json()
    assert second["source_attempt"]["reflection"]["revision"] == 3
    replay = post(client, "/practice-focus", payload, key)
    assert replay.json() == first.json()  # Immutable receipt remains exactly the original result.
    assert client.get("/api/v1/practice-focus").json()["focus"]["id"] == second["focus"]["id"]
    assert client.get(source_path).json()["reflection"]["revision"] == 3
    assert client.get("/api/v1/me").json()["progress"] == before
