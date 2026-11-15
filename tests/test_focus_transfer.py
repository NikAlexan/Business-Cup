from uuid import uuid4

from fastapi.testclient import TestClient

from app.content import generate_plan
from app.db import Resource
from tests.conftest import guest, post, upload
from tests.test_extra_practice import take


def setup_story(client, app):
    gid = guest(client).json()["guest_id"]
    plan = generate_plan(
        {"id": str(uuid4())}, {"priorities": [{"tag": "clarity", "exercise_ids": ["E03"]}]}, 1
    )
    drill = next(i for i in plan["lessons"][0]["items"] if i["exercise_id"] == "E03")
    story = next(i for i in plan["lessons"][0]["items"] if i["exercise_id"] == "E12")
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
    return drill, story


def choose_focus(client, app, worker, speech_file):
    drill, story = setup_story(client, app)
    rid = take(client, worker, speech_file, drill)
    source = post(client, "/exercise-attempts", {"plan_item_id": drill["id"], "recording_id": rid}).json()
    key = str(uuid4())
    payload = {"source_attempt_id": source["id"], "note": " Let the final word land. "}
    response = post(client, "/practice-focus", payload, key)
    assert response.status_code == 201, response.text
    assert post(client, "/practice-focus", payload, key).json() == response.json()
    return source, response.json()["focus"], story


def test_focus_transfers_from_drill_to_story_and_user_check_changes_no_credit(
    client, app, worker, speech_file
):
    source, focus, story = choose_focus(client, app, worker, speech_file)
    assert focus["skill"] == "word_endings" and focus["note"] == "Let the final word land."
    assert (
        client.get("/api/v1/exercise-attempts/" + source["id"]).json()["reflection"]["note"] == focus["note"]
    )
    state = client.get("/api/v1/plan-items/" + story["id"]).json()
    assert state["training_focus"] == focus
    uploaded = upload(
        client,
        speech_file,
        {"purpose": "exercise", "plan_item_id": story["id"], "training_focus_id": focus["id"]},
    )
    assert uploaded.status_code == 202, uploaded.text
    assert client.get("/api/v1/plan-items/" + story["id"]).json()["pending_take"]["training_focus"] == focus
    assert worker.run_once()
    saved = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": story["id"], "recording_id": uploaded.json()["recording"]["id"]},
    )
    assert saved.status_code == 201 and saved.json()["training_focus"] == focus
    progress = client.get("/api/v1/me").json()["progress"]
    plan = client.get("/api/v1/plan").json()
    path = "/api/v1/exercise-attempts/" + saved.json()["id"] + "/focus-check"
    check = client.put(path, json={"outcome": "partly"})
    assert check.status_code == 200 and check.json()["focus_check"]["source"] == "user_listening"
    assert client.put(path, json={"outcome": "partly"}).json() == check.json()
    active = client.get("/api/v1/practice-focus").json()
    assert active["focus"] == focus and active["last_check"]["outcome"] == "partly"
    assert client.get("/api/v1/me").json()["progress"] == progress
    assert client.get("/api/v1/plan").json() == plan
    assert client.put(path, json={"outcome": "mastered"}).status_code == 422


def test_changing_or_clearing_focus_cannot_rewrite_a_take_already_started(client, app, worker, speech_file):
    source, first, story = choose_focus(client, app, worker, speech_file)
    second = post(
        client,
        "/practice-focus",
        {"source_attempt_id": source["id"], "note": "Leave room between ideas.", "skill": "pauses"},
    ).json()["focus"]
    # The client froze the first focus when recording started; it remains an owned version.
    uploaded = upload(
        client,
        speech_file,
        {"purpose": "exercise", "plan_item_id": story["id"], "training_focus_id": first["id"]},
    )
    assert uploaded.status_code == 202
    assert client.delete("/api/v1/practice-focus/" + first["id"]).status_code == 204
    assert client.get("/api/v1/practice-focus").json()["focus"]["id"] == second["id"]
    assert client.delete("/api/v1/practice-focus/" + second["id"]).status_code == 204
    assert client.delete("/api/v1/practice-focus/" + second["id"]).status_code == 204
    assert client.get("/api/v1/practice-focus").json()["focus"] is None
    assert worker.run_once()
    saved = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": story["id"], "recording_id": uploaded.json()["recording"]["id"]},
    )
    assert saved.json()["training_focus"] == first
    assert client.get("/api/v1/plan-items/" + story["id"]).json()["training_focus"] is None


def test_focus_and_check_are_owned_and_cannot_be_attached_to_an_unrelated_drill(
    client, app, worker, speech_file
):
    source, focus, _ = choose_focus(client, app, worker, speech_file)
    assert (
        upload(
            client,
            speech_file,
            {
                "purpose": "exercise",
                "plan_item_id": source["plan_item_id"],
                "practice_only": "true",
                "training_focus_id": focus["id"],
            },
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/v1/exercise-attempts/" + source["id"] + "/focus-check", json={"outcome": "heard"}
        ).status_code
        == 422
    )
    with TestClient(app) as other:
        _, story = setup_story(other, app)
        assert (
            post(
                other, "/practice-focus", {"source_attempt_id": source["id"], "note": "Not mine."}
            ).status_code
            == 404
        )
        assert other.delete("/api/v1/practice-focus/" + focus["id"]).status_code == 404
        assert (
            upload(
                other,
                speech_file,
                {"purpose": "exercise", "plan_item_id": story["id"], "training_focus_id": focus["id"]},
            ).status_code
            == 404
        )


def test_focus_survives_the_next_local_day_without_claiming_a_skill_level(
    client, app, worker, speech_file, monkeypatch
):
    from datetime import date, timedelta

    from app.service import Service

    _, focus, story = choose_focus(client, app, worker, speech_file)
    before = client.get("/api/v1/me").json()["progress"]
    current = client.get("/api/v1/today").json()["local_date"]
    tomorrow = date.fromisoformat(current) + timedelta(days=1)
    original = Service.local_date
    monkeypatch.setattr(
        Service,
        "local_date",
        lambda self, timestamp=None: original(self, timestamp) if timestamp else tomorrow,
    )
    assert client.get("/api/v1/practice-focus").json()["focus"] == focus
    assert client.get("/api/v1/plan-items/" + story["id"]).json()["training_focus"] == focus
    assert client.get("/api/v1/me").json()["progress"] == before


def test_story_coaching_receives_the_frozen_focus_without_private_source_identifiers(
    client, app, worker, settings, speech_file
):
    from pydantic import SecretStr

    from tests.test_speech_reviews import ReviewProvider

    _, focus, story = choose_focus(client, app, worker, speech_file)
    uploaded = upload(
        client,
        speech_file,
        {"purpose": "exercise", "plan_item_id": story["id"], "training_focus_id": focus["id"]},
    ).json()
    assert worker.run_once()
    settings.openai_api_key = SecretStr("test-not-a-real-key")
    contexts = []

    class StoryProvider(ReviewProvider):
        def exercise_review(self, signal, context):
            contexts.append(context)
            return super().exercise_review(signal, context)

    worker.provider_factory = StoryProvider
    saved = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": story["id"], "recording_id": uploaded["recording"]["id"]},
    ).json()
    assert worker.run_once()
    assert contexts[0]["saved_focus"] == focus["note"]
    assert contexts[0]["story_focus"] == {
        key: focus[key] for key in ("skill_label", "listening_question", "rubric_version")
    }
    assert (
        client.get("/api/v1/exercise-attempts/" + saved["id"]).json()["speech_review"]["status"]
        == "completed"
    )
