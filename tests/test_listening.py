import copy
import hashlib
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.content import generate_plan
from app.db import Resource
from app.listening import CATALOG, boundaries, listening_words, planned_pause_feedback
from app.provider import ProviderFailure
from tests.conftest import FakeProvider, guest, post, upload


def setup(client, app):
    gid = guest(client).json()["guest_id"]
    plan = generate_plan(
        {"id": str(uuid4())}, {"priorities": [{"tag": "pauses", "exercise_ids": ["E08"]}]}, 1
    )
    item = next(i for i in plan["lessons"][0]["items"] if i["exercise_id"] == "E08")
    with app.state.database.session.begin() as db:
        db.add(Resource(id=plan["id"], guest_id=gid, kind="plan", data=plan))
    return item


def save_plan(client, item, boundary=0, key=None):
    return post(
        client,
        "/plan-items/" + item["id"] + "/listening-plan",
        {"example_id": "pauses-thought-groups-v1", "answer": "unsure", "boundary_index": boundary},
        key,
    )


def test_public_contrasts_share_identical_speech_and_differ_only_in_inserted_pause_position():
    example = CATALOG["examples"]["pauses-thought-groups-v1"]
    recovered = []
    for choice in example["choices"]:
        path = Path("frontend/public") / choice["audio_url"].lstrip("/")
        assert hashlib.sha256(path.read_bytes()).hexdigest() == choice["sha256"]
        signal, rate = sf.read(path, dtype="int16")
        assert rate == choice["sample_rate"] and signal.ndim == 1
        start, length = choice["inserted_pause_start_sample"], choice["inserted_pause_samples"]
        assert length / rate == 0.7 and not signal[start : start + length].any()
        assert len(signal) / rate == choice["duration_seconds"]
        base = np.concatenate((signal[:start], signal[start + length :]))
        pad = example["edge_padding_samples"]
        assert hashlib.sha256(base[pad:-pad].tobytes()).hexdigest() == example["base_pcm_sha256"]
        recovered.append(base)
    assert np.array_equal(*recovered)
    assert example["choices"][0]["pause_after_word_index"] != example["choices"][1]["pause_after_word_index"]


def transcript():
    tokens = "we reached the old bridge the path turns toward home".split()
    frames = [
        {"start": i * 0.4 + 0.1 + (1 if i >= 5 else 0), "end": i * 0.4 + 0.3 + (1 if i >= 5 else 0)}
        for i in range(len(tokens))
    ]
    return {"verified": True, "recognized_words": tokens, "words": frames}


def test_selected_boundary_reports_an_anchored_word_gap_without_global_or_semantic_scoring():
    actual = transcript()
    plan = {"expected_words": actual["recognized_words"].copy(), "boundary_word_index": 4}
    # A misread outside the local phrase does not invent or shift its known word boundary.
    actual["recognized_words"][0] = "they"
    actual["words"][1]["end"] = actual["words"][1]["start"]
    result = planned_pause_feedback(plan, actual, 6)
    assert result["available"] and result["gap_seconds"] == 1.2
    assert result["source"] == "transcript_timing" and result["evidence"]["quote"] == "bridge … the"
    assert set(result) == {"version", "available", "gap_seconds", "source", "unavailable_reason", "evidence"}


@pytest.mark.parametrize(
    "invalid",
    ["edge_zero", "selected_zero", "subsample", "outside_audio", "unverified", "missing_phrase", "ambiguous"],
)
def test_uncertain_selected_boundary_is_unavailable(invalid):
    actual = transcript()
    plan = {"expected_words": actual["recognized_words"].copy(), "boundary_word_index": 4}
    if invalid == "edge_zero":
        actual["words"][0]["end"] = actual["words"][0]["start"]
    elif invalid == "selected_zero":
        actual["words"][4]["end"] = actual["words"][4]["start"]
    elif invalid == "subsample":
        actual["words"][4]["end"] = actual["words"][4]["start"] + 1e-9
    elif invalid == "outside_audio":
        actual["words"][-1]["end"] = 10000
    elif invalid == "unverified":
        actual["verified"] = False
    elif invalid == "missing_phrase":
        actual["recognized_words"][4] = "building"
    else:
        plan["expected_words"] *= 2
    result = planned_pause_feedback(plan, actual, 6)
    assert not result["available"] and result["gap_seconds"] is None and result["evidence"] is None


def test_listening_choice_is_owned_idempotent_uncredited_and_bound_to_assigned_text(client, app, speech_file):
    item = setup(client, app)
    state = client.get("/api/v1/plan-items/" + item["id"]).json()
    assert state["listening_example"]["source"] == "synthetic"
    assert state["listening_plan"] is None
    before = client.get("/api/v1/me").json()["progress"]
    curriculum = client.get("/api/v1/plan").json()
    key = str(uuid4())
    response = save_plan(client, item, key=key)
    assert response.status_code == 201
    plan = response.json()
    assert save_plan(client, item, key=key).json() == plan
    assert plan["answer"] == "unsure" and plan["source"] == "user_listening"
    assert plan["before"] == state["listening_boundaries"][0]["before"]
    assert plan["boundary_word_index"] == state["listening_boundaries"][0]["word_index"]
    assert client.get("/api/v1/plan-items/" + item["id"]).json()["listening_plan"] == plan
    assert client.get("/api/v1/me").json()["progress"] == before
    assert client.get("/api/v1/plan").json() == curriculum
    assert save_plan(client, item, 1, key).status_code == 409
    assert save_plan(client, item, len(state["listening_boundaries"])).status_code == 422
    with TestClient(app) as other:
        guest(other)
        assert save_plan(other, item).status_code == 404
        foreign_item = setup(other, app)
        foreign_goal = save_plan(other, foreign_item).json()
    assert (
        upload(
            client,
            speech_file,
            {"purpose": "exercise", "plan_item_id": item["id"], "listening_plan_id": foreign_goal["id"]},
        ).status_code
        == 404
    )
    warmup = next(i for i in curriculum["lessons"][0]["items"] if i["exercise_id"] == "E01")
    assert save_plan(client, warmup).status_code == 422


def test_accepted_take_keeps_its_boundary_and_example_after_new_choices_or_catalog_changes(
    client, app, worker, speech_file, monkeypatch
):
    item = setup(client, app)
    first = save_plan(client, item).json()
    uploaded = upload(
        client,
        speech_file,
        {"purpose": "exercise", "plan_item_id": item["id"], "listening_plan_id": first["id"]},
    )
    assert uploaded.status_code == 202
    second = save_plan(client, item, 1).json()
    assert second["id"] != first["id"]
    future = {**copy.deepcopy(first["example"]), "id": "future-example", "explanation": "A future reference."}
    monkeypatch.setitem(CATALOG["examples"], future["id"], future)
    monkeypatch.setitem(CATALOG["default_by_exercise"], "E08", future["id"])
    resumed = client.get("/api/v1/plan-items/" + item["id"]).json()
    assert resumed["listening_plan"] == second and resumed["pending_take"]["listening_plan"] == first
    assert worker.run_once()
    saved = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": uploaded.json()["recording"]["id"]},
    )
    assert saved.status_code == 201 and saved.json()["listening_plan"] == first
    assert saved.json()["feedback"]["planned_pause"]["available"]
    assert saved.json()["feedback"]["planned_pause"]["evidence"]
    # Omission never silently attaches a new choice made elsewhere to an unseen take.
    legacy = upload(
        client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"], "practice_only": "true"}
    )
    assert legacy.status_code == 202 and legacy.json()["recording"]["listening_plan"] is None


def test_boundary_measurement_failure_does_not_reject_suitable_practice(client, app, worker, speech_file):
    item = setup(client, app)
    plan = save_plan(client, item).json()
    uploaded = upload(
        client,
        speech_file,
        {"purpose": "exercise", "plan_item_id": item["id"], "listening_plan_id": plan["id"]},
    ).json()

    class Unavailable(FakeProvider):
        def transcribe(self, signal, text):
            raise ProviderFailure("analysis_provider_rate_limited", True)

    worker.provider_factory = Unavailable
    assert worker.run_once()
    saved = post(
        client,
        "/exercise-attempts",
        {"plan_item_id": item["id"], "recording_id": uploaded["recording"]["id"]},
    )
    assert saved.status_code == 201 and saved.json()["status"] == "passed"
    assert not saved.json()["feedback"]["planned_pause"]["available"]
    assert saved.json()["listening_plan"] == plan


def test_curly_apostrophe_does_not_shift_the_selected_word_boundary():
    task = {"text": "We’ll cross the old bridge / and wait by the river."}
    point = boundaries(task)[0]
    assert point["word_index"] == 4
    tokens = listening_words(task["text"])
    times = [{"start": index * 0.4, "end": index * 0.4 + 0.2} for index in range(len(tokens))]
    actual = {"verified": True, "recognized_words": ["we'll", *tokens[1:]], "words": times}
    result = planned_pause_feedback(
        {"expected_words": tokens, "boundary_word_index": point["word_index"]}, actual, 10
    )
    assert result["available"] and result["evidence"]["quote"] == "bridge … and"
