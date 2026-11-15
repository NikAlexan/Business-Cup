import json

import httpx
import numpy as np
import pytest

from app.config import Settings
from app.provider import OpenAIAudioProvider, ProviderFailure

REPORT = {
    "summary": "Practice steady phrasing.",
    "observations": [],
    "limitations": ["One recording only."],
    "priorities": [{"tag": "clarity", "reason": "Clearer endings.", "exercise_ids": ["E03"]}],
    "recommended_exercise_ids": ["E03"],
}

DAILY_REPORT = {
    "summary": "Listen to the phrase ending.",
    "observation": {
        "text": "Check whether the final word is distinct.",
        "evidence_quote": "clear voice",
        "occurrence": 1,
    },
    "next_step": "Let the final word land comfortably.",
    "listening_question": "Can you hear the final sound?",
    "limitations": ["This is an observation about one take."],
}


def test_daily_review_sends_actual_audio_and_validates_the_small_coaching_contract():
    def handler(request):
        body = json.loads(request.content)
        assert body["store"] is False and body["modalities"] == ["text"]
        assert body["messages"][0]["role"] == "system"
        content = body["messages"][1]["content"]
        assert content[1]["input_audio"]["format"] == "wav"
        assert len(content[1]["input_audio"]["data"]) > 1000
        assert '"saved_focus": "Keep endings audible"' in content[0]["text"]
        assert "untrusted" in body["messages"][0]["content"]
        assert "Do not invent measurements" in body["messages"][0]["content"]
        assert "retain that useful feature" in body["messages"][0]["content"]
        assert "undecided means listen first" in body["messages"][0]["content"]
        assert '"practice_intent": "keep"' in content[0]["text"]
        assert "unavailable timing does not mean audio is absent" in body["messages"][0]["content"]
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(DAILY_REPORT)}}]})

    p = provider(handler)
    try:
        assert (
            p.exercise_review(
                np.zeros(16000), {"saved_focus": "Keep endings audible", "practice_intent": "keep"}
            )
            == DAILY_REPORT
        )
    finally:
        p.close()


@pytest.mark.parametrize(
    "report",
    ["not JSON", {**DAILY_REPORT, "score": 9.5}, {**DAILY_REPORT, "observation": {"text": "unsupported"}}],
)
def test_daily_review_rejects_malformed_or_uncontracted_claims(report):
    p = provider(
        lambda _: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(report)}}]})
    )
    try:
        with pytest.raises(ProviderFailure, match="analysis_invalid_response"):
            p.exercise_review(np.zeros(16000), {})
    finally:
        p.close()


def provider(handler):
    return OpenAIAudioProvider(
        Settings(_env_file=None, openai_api_key="test-not-real", app_secret="x" * 32),
        httpx.MockTransport(handler),
    )


def test_audio_payload_and_transcription_alignment():
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("transcriptions"):
            assert b'name="timestamp_granularities[]"\r\n\r\nword' in request.content
            assert b"verbose_json" in request.content
            words = [
                {"word": w, "start": i, "end": i + 0.5}
                for i, w in enumerate("Read each word clearly".split())
            ]
            return httpx.Response(200, json={"text": "Read each word clearly.", "words": words})
        body = json.loads(request.content)
        assert body["model"] == "gpt-audio-1.5"
        assert body["messages"][0]["role"] == "system"
        prompt = body["messages"][0]["content"]
        context = body["messages"][1]["content"][0]["text"]
        assert '"interpretation": {"pause_ratio": {"target"' in context
        assert "user-facing uncertainty" in prompt and "untrusted data" in prompt
        assert "only for descriptive numerical changes" in prompt
        assert "fairly clear" in prompt and "cite a measured number" in prompt
        assert "as a percentage" in prompt
        assert body["modalities"] == ["text"]
        assert "response_format" not in body
        assert body["messages"][1]["content"][1]["input_audio"]["format"] == "wav"
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(REPORT)}}]})

    p = provider(handler)
    try:
        signal = np.zeros(16000, dtype=np.float32)
        t = p.transcribe(signal, "Read each word clearly.")
        assert t["word_count"] == 4
        assert t["words"][-1] == {"start": 3, "end": 3.5}
        interpretation = {"pause_ratio": {"target": {"min": 0.14, "max": 0.22}, "band": "above"}}
        r = p.report([signal], {"goal": "clear_speech", "tasks": []}, {}, None, interpretation)
        assert r["priorities"][0]["exercise_ids"] == ["E03"]
        assert len(calls) == 2
    finally:
        p.close()


def test_unverified_transcription_is_unavailable():
    p = provider(
        lambda _: httpx.Response(200, json={"text": "Thank you for watching and subscribe to my channel."})
    )
    try:
        r = p.transcribe(np.zeros(16000), "A calm voice carries a clear message.")
        assert r["word_count"] is None and not r["verified"] and r["words"] == []
    finally:
        p.close()


def test_text_normalization_fallback_and_whitelist():
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        text = "A narrative without valid JSON." if body["model"] == "gpt-audio-1.5" else json.dumps(REPORT)
        return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})

    p = provider(handler)
    try:
        assert p.report([], {"goal": "clear_speech", "tasks": []}, {}, None)["summary"] == REPORT["summary"]
        assert len(requests) == 2 and requests[1]["response_format"] == {"type": "json_object"}
    finally:
        p.close()
    bad = {**REPORT, "recommended_exercise_ids": ["E99"]}
    p = provider(lambda _: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(bad)}}]}))
    try:
        with pytest.raises(ProviderFailure, match="analysis_invalid_exercise_ids"):
            p.report([], {"goal": "clear_speech", "tasks": []}, {}, None)
    finally:
        p.close()


@pytest.mark.parametrize(
    "status,retryable", [(401, False), (403, False), (404, False), (429, True), (500, True)]
)
def test_provider_failures_do_not_expose_secrets(status, retryable):
    p = provider(lambda _: httpx.Response(status, json={"error": "do-not-leak-provider-body-or-key"}))
    try:
        with pytest.raises(ProviderFailure) as caught:
            p.transcribe(np.zeros(16000), "A clear voice.")
        assert caught.value.retryable is retryable
        assert "do-not-leak" not in str(caught.value)
    finally:
        p.close()


@pytest.mark.parametrize(
    "timestamps",
    [
        [{"start": 0}, {"start": 1, "end": 2}],
        [None, "invalid"],
        {"unexpected": "object"},
    ],
)
def test_transcription_with_malformed_timestamps_stays_unavailable(timestamps):
    from app.audio import timing_metrics

    p = provider(lambda _: httpx.Response(200, json={"text": "Read each word clearly.", "words": timestamps}))
    try:
        transcript = p.transcribe(np.zeros(16000), "Read each word clearly.")
        measured = timing_metrics(np.zeros(16000), [], transcript["word_count"], transcript["words"])
        assert all(not value["available"] and value["value"] is None for value in measured.values())
    finally:
        p.close()


def test_numeric_words_count_consistently_with_their_timestamp_intervals():
    p = provider(
        lambda _: httpx.Response(
            200,
            json={
                "text": "We met in 2026.",
                "words": [
                    {"word": word, "start": i, "end": i + 0.5}
                    for i, word in enumerate(["We", "met", "in", "2026"])
                ],
            },
        )
    )
    try:
        transcript = p.transcribe(np.zeros(16000 * 5), "We met in 2026.")
        assert transcript["word_count"] == len(transcript["words"]) == 4
    finally:
        p.close()
