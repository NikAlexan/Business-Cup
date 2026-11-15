"""A/B self-listening saves one owned pre-reveal answer, without practice credit or an accuracy claim."""

import copy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import Resource
from tests.conftest import guest, post, upload
from tests.test_extra_practice import setup_plan, take


def pair(client, app, worker, speech_file):
    plan, item = setup_plan(client, app)
    first = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": take(client, worker, speech_file, item)},
    ).json()
    client.put(
        "/api/v1/exercise-attempts/" + first["id"] + "/reflection",
        json={"note": "Keep the final sounds comfortable.", "intent": "keep"},
    )
    uploaded = upload(
        client,
        speech_file,
        {
            "purpose": "exercise",
            "plan_item_id": item["id"],
            "practice_only": "true",
            "based_on_attempt_id": first["id"],
        },
    )
    assert uploaded.status_code == 202
    assert worker.run_once()
    second = post(
        client,
        "/exercise-attempts",
        {
            "plan_item_id": item["id"],
            "recording_id": uploaded.json()["recording"]["id"],
            "practice_only": True,
            "based_on_attempt_id": first["id"],
        },
    )
    assert second.status_code == 201 and second.json()["status"] == "passed", second.text
    return plan, first, second.json()


def test_pair_order_is_stable_private_and_resumable_after_reveal_or_daily_limit(
    client, app, worker, speech_file, settings, monkeypatch
):
    _, previous, current = pair(client, app, worker, speech_file)
    before = client.get("/api/v1/me").json()["progress"]
    draws = []
    monkeypatch.setattr("app.service.secrets.randbelow", lambda _: draws.append(True) or 1)
    path = "/exercise-attempts/" + current["id"] + "/comparison"
    key = str(uuid4())
    created = post(client, path, {}, key)
    assert created.status_code == 201 and created.headers["cache-control"] == "private, no-store"
    view = created.json()
    assert view["status"] == "awaiting_choice" and view["result"] is None
    assert view["focus_note"] == "Keep the final sounds comfortable."
    assert all(set(clip) == {"label", "audio_url"} for clip in view["clips"])
    assert all(
        value not in created.text
        for value in (previous["id"], current["id"], previous["recording_id"], current["recording_id"])
    )
    base = "/api/v1/listening-comparisons/" + view["id"]
    assert post(client, path, {}, key).json() == view
    settings.max_uploads_per_day = 0
    resumed = post(client, path, {})
    assert resumed.status_code == 200 and resumed.json() == view
    assert draws == [True]  # Reopening never rerolls A/B, even with another operation key.
    # Byte ranges are streamed through the existing authenticated endpoint, with no redirect revealing the mapping.
    alias = client.get(view["clips"][0]["audio_url"], headers={"Range": "bytes=0-31"})
    direct = client.get(
        "/api/v1/recordings/" + current["recording_id"] + "/audio", headers={"Range": "bytes=0-31"}
    )
    assert alias.status_code == 206 and alias.content == direct.content and len(alias.content) == 32
    assert alias.headers["cache-control"] == "private, no-store" and "location" not in alias.headers
    assert client.get(base + "/audio/a", headers={"Range": "bytes=999999999999-"}).status_code == 416
    assert client.get(base + "/audio/previous").status_code == 422
    saved = client.put(base + "/result", json={"choice": "no_clear_difference", "note": "Both work for me."})
    assert saved.status_code == 200
    revealed = saved.json()
    assert revealed["clips"][0]["role"] == "current" and revealed["clips"][1]["role"] == "previous"
    assert revealed["result"]["source"] == "user_listening"
    assert post(client, path, {}).json() == revealed
    assert post(client, path, {}, key).json() == view  # Immutable receipt deliberately predates the answer.
    assert client.get(base).json() == revealed  # Authoritative GET is always the latest saved state.
    with TestClient(app) as other:
        assert other.get(base).status_code == 401
        guest(other)
        for suffix in ("", "/audio/a", "/audio/b"):
            denied = other.get(base + suffix)
            assert denied.status_code == 404 and denied.headers["cache-control"] == "private, no-store"
        assert other.put(base + "/result", json={"choice": "a"}).status_code == 404
        assert post(other, path, {}).status_code == 404
    assert client.get("/api/v1/me").json()["progress"] == before


@pytest.mark.parametrize("choice", ["a", "b", "no_clear_difference", "unsure"])
def test_first_answer_and_snapshot_survive_retries_later_reflection_and_archive(
    client, app, worker, speech_file, choice
):
    plan, previous, current = pair(client, app, worker, speech_file)
    created = post(client, "/exercise-attempts/" + current["id"] + "/comparison", {}).json()
    path = "/api/v1/listening-comparisons/" + created["id"]
    before = client.get("/api/v1/me").json()["progress"]
    frozen = client.get("/api/v1/exercise-attempts/" + current["id"]).json()
    answer = {"choice": choice, "note": "  The last phrase sounds comfortable.  "}
    saved = client.put(path + "/result", json=answer)
    assert saved.status_code == 200
    assert saved.json()["result"]["note"] == answer["note"].strip()
    assert client.put(path + "/result", json=answer).json() == saved.json()
    refused = client.put(
        path + "/result", json={"choice": "b" if choice != "b" else "a", "note": "Changed after reveal."}
    )
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "comparison_already_answered"
    assert client.get(path).json() == saved.json()
    client.put(
        "/api/v1/exercise-attempts/" + previous["id"] + "/reflection",
        json={"note": "Later source edit.", "intent": "experiment"},
    )
    assert client.get("/api/v1/me").json()["progress"] == before
    with app.state.database.session.begin() as db:
        row = db.get(Resource, plan["id"])
        row.data = {**row.data, "status": "archived"}
    before = client.get("/api/v1/me").json()["progress"]
    assert post(client, "/exercise-attempts/" + current["id"] + "/comparison", {}).json() == saved.json()
    assert client.get(path).json()["focus_note"] == created["focus_note"]
    assert client.get("/api/v1/exercise-attempts/" + current["id"]).json() == frozen
    assert client.get("/api/v1/me").json()["progress"] == before
    assert client.delete("/api/v1/guest-data").status_code == 204
    with app.state.database.session() as db:
        assert db.scalar(select(Resource).where(Resource.id == created["id"])) is None


def test_unavailable_and_mismatched_pairs_never_create_comparisons(client, app, worker, speech_file):
    _, previous, current = pair(client, app, worker, speech_file)
    assert post(client, "/exercise-attempts/" + previous["id"] + "/comparison", {}).status_code == 422
    with app.state.database.session.begin() as db:
        source = db.get(Resource, previous["id"])
        source.data = {**source.data, "plan_item_id": str(uuid4())}
    assert post(client, "/exercise-attempts/" + current["id"] + "/comparison", {}).status_code == 422
    with app.state.database.session.begin() as db:
        source = db.get(Resource, previous["id"])
        value = copy.deepcopy(source.data)
        value["plan_item_id"] = current["plan_item_id"]
        value["status"] = "needs_retry"
        source.data = value
    assert post(client, "/exercise-attempts/" + current["id"] + "/comparison", {}).status_code == 422
    with app.state.database.session() as db:
        assert not db.scalars(select(Resource).where(Resource.kind == "take_comparison")).all()
