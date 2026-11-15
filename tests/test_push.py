from datetime import UTC, datetime, time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pywebpush import WebPushException

from app import push
from app.db import Database, Guest, Resource
from app.main import create_app
from app.push import due, message, send
from app.worker import Worker
from tests.conftest import guest

NY = ZoneInfo("America/New_York")


def at(h):
    return datetime(2026, 11, 15, h, tzinfo=NY)


def s(days, last):
    return {"current_days": days, "longest_days": days, "last_practice_on": last}


def test_due_evening_after_yesterday():
    assert due(s(3, "2026-11-14"), at(19), None)


def test_due_not_before_19():
    assert not due(s(3, "2026-11-14"), at(18), None)


def test_due_not_if_practiced_today():
    assert not due(s(3, "2026-11-15"), at(20), None)


def test_due_not_if_no_streak():
    assert not due(s(0, None), at(20), None)


def test_due_once_per_day():
    assert not due(s(3, "2026-11-14"), at(21), "2026-11-15")


def test_due_uses_guest_timezone():
    local = datetime(2026, 11, 16, 0, 30, tzinfo=UTC).astimezone(NY)  # 19:30 NY, 15 Nov
    assert due(s(2, "2026-11-14"), local, None)


def test_message_mentions_days():
    assert "5" in message(5)["body"]


def test_send_reports_gone(monkeypatch, settings):
    def gone(**_):
        raise WebPushException("gone", response=SimpleNamespace(status_code=410))

    monkeypatch.setattr(push, "webpush", gone)
    assert send(settings, {"endpoint": "x", "keys": {}}, message(1)) is False


SUB = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "k", "auth": "a"}}


@pytest.fixture
def vapid_settings(settings):
    return settings.model_copy(update={"vapid_public_key": "pub", "vapid_private_key": SecretStr("priv")})


@pytest.fixture
def pclient(vapid_settings):
    with TestClient(create_app(vapid_settings)) as c:
        yield c


@pytest.fixture
def sent(monkeypatch):
    calls = []

    def fake(settings, subscription, payload):
        calls.append(payload)
        return True

    monkeypatch.setattr(push, "send", fake)
    return calls


def test_subscribe_and_unsubscribe(pclient):
    guest(pclient)
    assert pclient.put("/api/v1/push/subscription", json=SUB).status_code == 204
    me = pclient.get("/api/v1/me").json()
    assert me["push_enabled"] is True and me["push_public_key"] == "pub" and "push" not in me
    assert pclient.delete("/api/v1/push/subscription").status_code == 204
    assert pclient.get("/api/v1/me").json()["push_enabled"] is False


def test_push_requires_session(pclient):
    assert pclient.put("/api/v1/push/subscription", json=SUB).status_code == 401


def test_push_disabled_without_vapid(client):
    guest(client)
    r = client.put("/api/v1/push/subscription", json=SUB)
    assert r.status_code == 503 and r.json()["error"]["code"] == "push_disabled"
    assert client.get("/api/v1/me").json()["push_public_key"] is None


def test_push_test_requires_subscription(pclient):
    guest(pclient)
    assert pclient.post("/api/v1/push/test").status_code == 409


def test_push_test_sends_now(pclient, sent):
    guest(pclient)
    pclient.put("/api/v1/push/subscription", json=SUB)
    assert pclient.post("/api/v1/push/test").status_code == 204
    assert len(sent) == 1 and "1" in sent[0]["body"]


def test_push_test_drops_gone_subscription(pclient, monkeypatch):
    guest(pclient)
    pclient.put("/api/v1/push/subscription", json=SUB)
    monkeypatch.setattr(push, "send", lambda *a: False)
    r = pclient.post("/api/v1/push/test")
    assert r.status_code == 410 and r.json()["error"]["code"] == "push_subscription_gone"
    assert pclient.get("/api/v1/me").json()["push_enabled"] is False


@pytest.fixture
def evening():
    # streak() reads the real clock, so anchor the test "now" to today's real New York date.
    today = datetime.now(NY).date()
    return datetime.combine(today, time(19, 30), NY), today


@pytest.fixture
def streak_guest(pclient, vapid_settings, evening):
    _, today = evening
    guest(pclient)
    pclient.put("/api/v1/push/subscription", json=SUB)
    gid = pclient.get("/api/v1/me").json()["guest_id"]
    yesterday = (today - timedelta(days=1)).isoformat()
    db = Database(vapid_settings.database_url)
    with db.session() as s:
        s.add(
            Resource(
                guest_id=gid,
                kind="plan",
                data={"lessons": [{"completed_at": "x", "completed_on": yesterday}]},
            )
        )
        s.commit()
    return gid


@pytest.fixture
def pworker(vapid_settings):
    return Worker(vapid_settings)


def stored_push(settings, gid):
    with Database(settings.database_url).session() as s:
        return s.get(Guest, gid).data.get("push")


def test_remind_sends_once_per_day(pworker, streak_guest, sent, evening):
    now, today = evening
    assert pworker.remind_streaks(now) == 1
    assert pworker.remind_streaks(now + timedelta(minutes=10)) == 0
    assert len(sent) == 1 and "1" in sent[0]["body"]
    assert stored_push(pworker.settings, streak_guest)["last_sent_on"] == today.isoformat()


def test_remind_not_before_evening(pworker, streak_guest, sent, evening):
    now, _ = evening
    assert pworker.remind_streaks(now.replace(hour=12)) == 0 and sent == []


def test_remind_drops_gone_subscription(pworker, streak_guest, monkeypatch, evening):
    monkeypatch.setattr(push, "send", lambda *a: False)
    assert pworker.remind_streaks(evening[0]) == 0
    assert stored_push(pworker.settings, streak_guest) is None


def test_remind_skips_without_vapid(settings, streak_guest, sent, evening):
    assert Worker(settings).remind_streaks(evening[0]) == 0 and sent == []


def test_remind_keeps_concurrent_guest_writes(pworker, streak_guest, monkeypatch, evening):
    # A request handler (or billing webhook) commits while the push is in flight.
    def send_while_guest_changes(settings, subscription, payload):
        with Database(settings.database_url).session() as s:
            g = s.get(Guest, streak_guest)
            g.data = {**g.data, "preferences": {**g.data["preferences"], "goal": "expressive_voice"}}
            s.commit()
        return True

    monkeypatch.setattr(push, "send", send_while_guest_changes)
    assert pworker.remind_streaks(evening[0]) == 1
    with Database(pworker.settings.database_url).session() as s:
        data = s.get(Guest, streak_guest).data
    assert data["preferences"]["goal"] == "expressive_voice" and data["push"]["last_sent_on"]
