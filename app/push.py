"""Web Push streak reminders: who is due, what to say, how to send."""

import json
from datetime import datetime, timedelta

from pywebpush import WebPushException, webpush

REMIND_HOUR = 19
TEMPLATES = [
    "🔥 {days}-day streak — don't break it. Five minutes is enough.",
    "Your voice streak is {days} days. Keep it alive tonight.",
    "{days} days in a row! One short lesson keeps the streak going.",
]


def due(streak: dict, local_now: datetime, last_sent_on: str | None) -> bool:
    today = local_now.date()
    return (
        streak["current_days"] >= 1
        and streak["last_practice_on"] == (today - timedelta(days=1)).isoformat()
        and local_now.hour >= REMIND_HOUR
        and last_sent_on != today.isoformat()
    )


def message(days: int) -> dict:
    return {"title": "Resonance", "body": TEMPLATES[days % len(TEMPLATES)].format(days=days), "url": "/"}


def send(settings, subscription: dict, payload: dict) -> bool:
    """False when the push service says the subscription is gone (404/410)."""
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key.get_secret_value(),
            vapid_claims={"sub": settings.vapid_subject},
            ttl=3600,
        )
    except WebPushException as exc:
        if exc.response is not None and exc.response.status_code in (404, 410):
            return False
        raise
    return True
