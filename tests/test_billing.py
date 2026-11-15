import hashlib
import hmac
import json
import time

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import billing
from app.main import create_app
from tests.conftest import assessment, guest, post

SECRET = "whsec_test"


@pytest.fixture
def stripe_client(settings, monkeypatch):
    s = settings.model_copy(
        update={
            "billing_provider": "stripe_test",
            "stripe_secret_key": SecretStr("sk_test_x"),
            "stripe_webhook_secret": SecretStr(SECRET),
            "stripe_price_monthly": "price_m",
            "stripe_price_yearly": "price_y",
        }
    )
    calls = []

    def fake(settings, method, path, data=None):
        calls.append((method, path, data))
        if path.startswith("prices/"):
            return {"unit_amount": 900 if path.endswith("_m") else 7900, "currency": "usd"}
        return {"url": "https://stripe.test/" + path}

    monkeypatch.setattr(billing, "stripe", fake)
    with TestClient(create_app(s)) as c:
        c.calls = calls
        yield c


def send(client, event, secret=SECRET):
    body = json.dumps(event).encode()
    t = str(int(time.time()))
    sig = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return client.post(
        "/api/v1/billing/webhook", content=body, headers={"Stripe-Signature": f"t={t},v1={sig}"}
    )


def sub_event(subject, status, created):
    return {
        "type": "customer.subscription.updated",
        "created": created,
        "data": {
            "object": {
                "id": "sub_1",
                "customer": "cus_1",
                "status": status,
                "metadata": {"subject_id": subject},
                "items": {
                    "data": [{"price": {"recurring": {"interval": "month"}}, "current_period_end": 99}]
                },
            }
        },
    }


def test_subscription_unlocks_training_and_is_canceled_on_delete(stripe_client):
    c = stripe_client
    subject = guest(c).json()["subject_id"]
    me = c.get("/api/v1/me").json()
    assert me["capabilities"] == {"assessment": True, "daily_training": False, "exercise_coaching": False}
    assert me["subscription"]["status"] is None

    assert c.get("/api/v1/billing/plans").json()["plans"][1] == {
        "interval": "year",
        "amount": 7900,
        "currency": "usd",
    }
    r = post(c, "/billing/checkout-session", {"interval": "year"})
    assert r.status_code == 200 and r.json()["url"].endswith("checkout/sessions")
    data = c.calls[-1][2]
    assert (
        data["line_items[0][price]"] == "price_y"
        and data["subscription_data[metadata][subject_id]"] == subject
    )
    assert data["subscription_data[trial_period_days]"] == 7

    assert assessment(c, kind="reassessment").json()["error"]["code"] == "access_denied"

    assert send(c, sub_event(subject, "trialing", 10), secret="wrong").status_code == 400
    assert send(c, sub_event(subject, "trialing", 10)).status_code == 200
    assert send(c, sub_event(subject, "canceled", 5)).status_code == 200  # older, ignored
    me = c.get("/api/v1/me").json()
    assert me["capabilities"]["daily_training"] is True
    assert me["subscription"]["plan"] == "month" and me["subscription"]["current_period_end"] == 99
    assert post(c, "/billing/checkout-session", {"interval": "month"}).status_code == 409
    assert post(c, "/billing/portal-session", {}).json()["url"].endswith("billing_portal/sessions")
    assert c.calls[-1][2]["customer"] == "cus_1"

    assert c.delete("/api/v1/guest-data").status_code == 204
    assert c.calls[-1][:2] == ("DELETE", "subscriptions/sub_1")


def test_billing_disabled_keeps_mvp_access(client):
    guest(client)
    me = client.get("/api/v1/me").json()
    assert me["capabilities"]["daily_training"] is True and me["subscription"] is None
    assert client.get("/api/v1/billing/plans").status_code == 404


def test_subscription_gates_new_practice_but_retains_saved_focus_audio_and_comparison(
    stripe_client, worker, speech_file
):
    from tests.conftest import upload
    from tests.test_extra_practice import setup_plan, take

    c = stripe_client
    _, item = setup_plan(c, c.app)
    subject = c.get("/api/v1/me").json()["subject_id"]
    fields = {"purpose": "exercise", "plan_item_id": item["id"]}
    denied = upload(c, speech_file, fields)
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "access_denied"
    assert (
        post(c, "/exercise-attempts", {"plan_item_id": item["id"], "self_confirmed": True}).status_code == 403
    )
    assert send(c, sub_event(subject, "trialing", 20)).status_code == 200
    rid = take(c, worker, speech_file, item)
    first = post(c, "/exercise-attempts", {"plan_item_id": item["id"], "recording_id": rid}).json()
    focus = post(
        c,
        "/practice-focus",
        {"source_attempt_id": first["id"], "note": "Keep the final words comfortable.", "intent": "keep"},
    )
    assert focus.status_code == 201
    extra_id = take(c, worker, speech_file, item, extra=True)
    extra = post(
        c,
        "/exercise-attempts",
        {
            "plan_item_id": item["id"],
            "recording_id": extra_id,
            "practice_only": True,
            "based_on_attempt_id": first["id"],
        },
    ).json()
    comparison = post(c, "/exercise-attempts/" + extra["id"] + "/comparison", {})
    assert comparison.status_code == 201
    comparison_id = comparison.json()["id"]
    saved = c.put("/api/v1/listening-comparisons/" + comparison_id + "/result", json={"choice": "unsure"})
    assert saved.status_code == 200
    progress = c.get("/api/v1/me").json()["progress"]
    assert send(c, sub_event(subject, "canceled", 30)).status_code == 200
    assert not c.get("/api/v1/me").json()["capabilities"]["daily_training"]
    assert upload(c, speech_file, {**fields, "practice_only": "true"}).status_code == 403
    assert (
        post(
            c, "/practice-focus", {"source_attempt_id": first["id"], "note": "A new paid focus."}
        ).status_code
        == 403
    )
    assert c.get("/api/v1/exercise-attempts/" + extra["id"]).status_code == 200
    assert c.get("/api/v1/recordings/" + rid + "/audio", headers={"Range": "bytes=0-31"}).status_code == 206
    assert c.get("/api/v1/practice-focus").json()["focus"]["id"] == focus.json()["focus"]["id"]
    assert post(c, "/exercise-attempts/" + extra["id"] + "/comparison", {}).json() == saved.json()
    assert c.get("/api/v1/me").json()["progress"] == progress
