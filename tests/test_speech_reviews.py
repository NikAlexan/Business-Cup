import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.provider import ProviderFailure
from tests.conftest import FakeProvider, guest, post, upload
from tests.test_extra_practice import setup_plan, take


class ReviewProvider(FakeProvider):
    def exercise_review(self, signal, context):
        return {
            "summary": "Listen to your phrase ending.",
            "observation": {
                "text": "Check how the final word lands.",
                "evidence_quote": " ".join(context["verified_transcript"].split()[:2]),
                "occurrence": 1,
            },
            "next_step": "Let the final word land without extra loudness.",
            "listening_question": "Can you hear the final sound comfortably?",
            "limitations": ["One take cannot establish a lasting pattern."],
        }


def saved_take(client, app, worker, settings, speech_file):
    _, item = setup_plan(client, app)
    rid = take(client, worker, speech_file, item)
    settings.openai_api_key = SecretStr("test-not-a-real-key")
    worker.provider_factory = ReviewProvider
    response = post(client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid})
    assert response.status_code == 201, response.text
    return item, response.json()


def test_review_runs_after_completion_and_preserves_audio_reward_and_concurrent_reflection(
    client, app, worker, settings, speech_file
):
    _, attempt = saved_take(client, app, worker, settings, speech_file)
    assert attempt["status"] == "passed" and attempt["speech_review"]["status"] == "queued"
    before = client.get("/api/v1/me").json()["progress"]
    path = "/api/v1/exercise-attempts/" + attempt["id"]

    class ConcurrentReflection(ReviewProvider):
        def exercise_review(self, signal, context):
            assert client.put(path + "/reflection", json={"note": "My own focus."}).status_code == 200
            return super().exercise_review(signal, context)

    worker.provider_factory = ConcurrentReflection
    assert worker.run_once()
    completed = client.get(path).json()
    review = completed["speech_review"]
    assert review["status"] == "completed" and review["source"] == "audio_model"
    evidence = review["report"]["observation"]["evidence"]
    assert 0 <= evidence["start_seconds"] < evidence["end_seconds"]
    assert completed["reflection"]["note"] == "My own focus."
    assert client.get("/api/v1/me").json()["progress"] == before
    assert client.get("/api/v1/recordings/" + attempt["recording_id"]).json()["status"] == "completed"
    assert post(client, path.removeprefix("/api/v1") + "/review", {}).json()["speech_review"] == review
    assert not worker.run_once()
    with TestClient(app) as other:
        guest(other)
        assert post(other, path.removeprefix("/api/v1") + "/review", {}).status_code == 404


def test_lightweight_quality_checks_are_claimed_before_queued_coaching(
    client, app, worker, settings, speech_file
):
    item, _ = saved_take(client, app, worker, settings, speech_file)
    extra = upload(
        client, speech_file, {"purpose": "exercise", "plan_item_id": item["id"], "practice_only": "true"}
    )
    assert extra.status_code == 202
    assert worker.claim()["job"]["type"] == "recording_check"


@pytest.mark.parametrize(
    "budget,reason",
    [
        ("max_exercise_reviews_per_day", "daily_limit"),
        ("max_total_exercise_reviews_per_day", "service_daily_limit"),
    ],
)
def test_review_budget_never_rejects_completion(client, app, worker, settings, speech_file, budget, reason):
    setattr(settings, budget, 1)
    item, first = saved_take(client, app, worker, settings, speech_file)
    assert worker.run_once()
    rid = take(client, worker, speech_file, item, extra=True)
    response = post(
        client, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid, "practice_only": True}
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "passed"
    assert response.json()["speech_review"]["reason"] == reason
    assert response.json()["reward"]["notes"] == 0
    assert first["speech_review"]["job_id"]


def test_failed_review_is_retryable_without_rejecting_or_recounting_audio(
    client, app, worker, settings, speech_file
):
    settings.job_max_attempts = 1
    _, attempt = saved_take(client, app, worker, settings, speech_file)

    class FailedProvider(ReviewProvider):
        def exercise_review(self, signal, context):
            raise ProviderFailure("analysis_provider_rate_limited", True)

    worker.provider_factory = FailedProvider
    assert worker.run_once()
    jid = attempt["speech_review"]["job_id"]
    path = "/api/v1/exercise-attempts/" + attempt["id"]
    failed = client.get(path).json()
    assert failed["status"] == "passed" and failed["speech_review"]["status"] == "failed"
    assert client.get("/api/v1/recordings/" + attempt["recording_id"]).json()["status"] == "completed"
    progress = client.get("/api/v1/me").json()["progress"]
    assert post(client, "/jobs/" + jid + "/retry", {}).status_code == 202
    worker.provider_factory = ReviewProvider
    assert worker.run_once()
    assert client.get(path).json()["speech_review"]["status"] == "completed"
    assert client.get("/api/v1/me").json()["progress"] == progress


@pytest.mark.parametrize("malformed", ["timing", "quote"])
def test_review_does_not_publish_unsupported_evidence(client, app, worker, settings, speech_file, malformed):
    settings.job_max_attempts = 1
    _, attempt = saved_take(client, app, worker, settings, speech_file)

    class UnsupportedProvider(ReviewProvider):
        def transcribe(self, signal, text):
            result = super().transcribe(signal, text)
            if malformed == "timing":
                result["words"][-1]["end"] = 10000
            return result

        def exercise_review(self, signal, context):
            report = super().exercise_review(signal, context)
            report["observation"]["evidence_quote"] = "invented absent phrase"
            return report

    worker.provider_factory = UnsupportedProvider
    assert worker.run_once()
    result = client.get("/api/v1/exercise-attempts/" + attempt["id"]).json()
    assert result["status"] == "passed"
    assert result["speech_review"]["status"] == ("unavailable" if malformed == "timing" else "failed")
    assert result["speech_review"]["report"] is None
