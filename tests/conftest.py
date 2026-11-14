import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import Settings
from app.db import Base, Database
from app.main import create_app
from app.worker import Worker


@pytest.fixture(scope="session")
def speech_file(tmp_path_factory):
    path = tmp_path_factory.mktemp("audio") / "speech.wav"
    text = json.loads((Path("app/content/protocol.json")).read_text())[0]["text"]
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"flite=text='{text}':voice=slt",
            "-ar",
            "16000",
            str(path),
        ],
        check=True,
    )
    return path


@pytest.fixture
def settings(tmp_path, monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL", "sqlite:///" + str(tmp_path / "test.db"))
    if not url.startswith("sqlite") and "test" not in url.rsplit("/", 1)[-1]:
        raise RuntimeError("TEST_DATABASE_URL must point to a dedicated test database")
    monkeypatch.setenv("DATABASE_URL", url)
    database = Database(url)
    Base.metadata.drop_all(database.engine)
    with database.engine.begin() as db:
        db.execute(text("DROP TABLE IF EXISTS alembic_version"))
    command.upgrade(Config("alembic.ini"), "head")
    database.engine.dispose()
    return Settings(
        _env_file=None,
        database_url=url,
        audio_data=tmp_path / "audio",
        openai_api_key="",
        app_secret="test-secret-that-is-at-least-32-characters-long",
        vad_model_path=Path("models/silero_vad.onnx"),
        asr_model_dir=Path("models/asr"),
    )


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def post(client, path, payload, key=None):
    return client.post("/api/v1" + path, json=payload, headers={"Idempotency-Key": key or str(uuid4())})


def guest(client, key=None):
    return post(
        client,
        "/guest-session",
        {
            "goal": "clear_speech",
            "timezone": "America/New_York",
            "locale": "en-US",
            "consent": {"audio_processing": True, "policy_version": "2026-11-14"},
        },
        key,
    )


def assessment(client, kind="initial", demo=False):
    return post(
        client,
        "/assessments",
        {
            "kind": kind,
            "recording_conditions": {
                "device_label": "Test microphone",
                "distance_cm": 20,
                "environment": "quiet_room",
                "notes": None,
            },
            "demo_override": demo,
        },
    )


def upload(client, path, fields, key=None):
    return client.post(
        "/api/v1/recordings",
        data=fields,
        files={"file": ("recording.wav", path.read_bytes(), "audio/wav")},
        headers={"Idempotency-Key": key or str(uuid4())},
    )


class FakeProvider:
    """Deterministic paid-provider substitute, used ONLY in tests."""

    def __init__(self, settings):
        self.usage = []

    def close(self):
        pass

    def transcribe(self, signal, text):
        words, t = [], 0.5
        for w in text.split():
            words.append({"start": t, "end": t + 0.3})
            t += 0.3 + (0.5 if w[-1] in ".?!" else 0.05)
        return {"text": text, "word_count": len(words), "verified": True, "words": words}

    def report(self, signals, assessment, measurements, comparison, interpretation=None):
        return {
            "summary": "Practice clear phrase endings and intentional intonation.",
            "observations": [
                {"category": "clarity", "text": "Try clearer endings.", "source": "audio_model"}
            ],
            "limitations": ["Test provider response."],
            "priorities": [
                {"tag": "clarity", "reason": "Clearer words.", "exercise_ids": ["E03", "E04"]},
                {"tag": "intonation", "reason": "Varied delivery.", "exercise_ids": ["E09", "E10"]},
            ],
            "recommended_exercise_ids": ["E01", "E03", "E09", "E12"],
        }


@pytest.fixture
def worker(settings, app):
    return Worker(settings, app.state.database, provider_factory=FakeProvider)


def complete_assessment(client, worker, speech_file, kind="initial", demo=False, before_submit=None):
    created = assessment(client, kind, demo)
    assert created.status_code == 201, created.text
    a = created.json()
    for t in a["tasks"]:
        r = upload(
            client, speech_file, {"purpose": "assessment", "assessment_id": a["id"], "task_id": t["id"]}
        )
        assert r.status_code == 202, r.text
        assert worker.run_once()
        job = client.get("/api/v1/jobs/" + r.json()["job_id"]).json()
        assert job["status"] == "completed", job
    if before_submit:
        before_submit()
    submitted = post(client, "/assessments/" + a["id"] + "/submit", {})
    assert submitted.status_code == 202, submitted.text
    assert worker.run_once()
    job = client.get("/api/v1/jobs/" + submitted.json()["job_id"]).json()
    assert job["status"] == "completed", job
    return client.get("/api/v1/assessments/" + a["id"]).json()
