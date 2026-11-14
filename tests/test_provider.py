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


def provider(handler):
    return OpenAIAudioProvider(
        Settings(_env_file=None, openai_api_key="test-not-real"), httpx.MockTransport(handler)
    )


def test_audio_payload_and_transcription_alignment():
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("transcriptions"):
            return httpx.Response(200, json={"text": "Read each word clearly."})
        body = json.loads(request.content)
        assert body["model"] == "gpt-audio-1.5"
        assert body["modalities"] == ["text"]
        assert "response_format" not in body
        assert body["messages"][0]["content"][1]["input_audio"]["format"] == "wav"
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(REPORT)}}]})

    p = provider(handler)
    try:
        signal = np.zeros(16000, dtype=np.float32)
        assert p.transcribe(signal, "Read each word clearly.")["word_count"] == 4
        r = p.report([signal], {"goal": "clear_speech", "tasks": []}, {}, None)
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
        assert r["word_count"] is None and not r["verified"]
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
