"""Explicit browser-test fixture. Never used by the application or its production worker."""

from app.provider import ProviderFailure, words


class BrowserAssessmentProvider:
    failed_once = set()

    def __init__(self, settings):
        if settings.openai_api_key.get_secret_value():
            raise RuntimeError("browser_fixture_requires_empty_paid_credentials")
        self.usage = []

    def close(self):
        pass

    def transcribe(self, signal, text):
        tokens = words(text)
        step = (len(signal) / 16000 - 0.2) / len(tokens)
        return {
            "text": text,
            "verified": True,
            "word_count": len(tokens),
            "recognized_words": tokens,
            "words": [
                {"start": 0.1 + index * step, "end": 0.1 + (index + 0.8) * step}
                for index in range(len(tokens))
            ],
        }

    def report(self, signals, assessment, measurements, comparison, interpretation=None):
        # Force the first analysis to require an explicit saved-job retry, not another upload.
        if assessment["id"] not in self.failed_once:
            self.failed_once.add(assessment["id"])
            raise ProviderFailure("analysis_provider_rate_limited", True)
        return {
            "summary": "Test-only listening summary for browser verification.",
            "observations": [],
            "limitations": [
                "Test-only report from a deterministic provider; no AI listening assessment was performed."
            ],
            "priorities": [{"tag": "clarity", "reason": "Test practice focus.", "exercise_ids": ["E03"]}],
            "recommended_exercise_ids": ["E03"],
        }
