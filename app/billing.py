"""Stripe test-mode subscriptions over plain HTTPS; state lives in guest.data["subscription"]."""

import hashlib
import hmac
import json
import time

import httpx
from sqlalchemy import select

from app.db import Guest
from app.errors import fail

API = "https://api.stripe.com/v1/"
PAID = {"active", "trialing", "past_due"}  # past_due: Stripe is still retrying the card


def has_access(settings, guest, capability):
    if capability == "assessment" or settings.billing_provider == "none":
        return capability in {"assessment", "daily_training"}
    return (guest.data.get("subscription") or {}).get("status") in PAID


def stripe(settings, method, path, data=None):
    try:
        r = httpx.request(
            method,
            API + path,
            data=data,
            auth=(settings.stripe_secret_key.get_secret_value(), ""),
            timeout=20,
        )
    except httpx.HTTPError:
        fail(502, "billing_unavailable", "The payment service is unavailable. Try again.")
    if r.status_code >= 400:
        fail(502, "billing_unavailable", "The payment service rejected the request. Try again.")
    return r.json()


def require_billing(settings):
    if settings.billing_provider == "none":
        fail(404, "billing_disabled", "Billing is not enabled.")


_prices = {}  # ponytail: process cache; restart the API after changing prices in Stripe


def plans(settings):
    require_billing(settings)
    out = []
    for interval, price_id in (
        ("month", settings.stripe_price_monthly),
        ("year", settings.stripe_price_yearly),
    ):
        if price_id not in _prices:
            p = stripe(settings, "GET", "prices/" + price_id)
            _prices[price_id] = {"amount": p["unit_amount"], "currency": p["currency"]}
        out.append({"interval": interval, **_prices[price_id]})
    return {"plans": out, "trial_days": settings.stripe_trial_days, "test_mode": True}


def checkout(settings, guest, interval, origin):
    require_billing(settings)
    if has_access(settings, guest, "daily_training"):
        fail(409, "already_subscribed", "You already have an active subscription.")
    price = settings.stripe_price_monthly if interval == "month" else settings.stripe_price_yearly
    data = {
        "mode": "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": 1,
        "client_reference_id": guest.subject_id,
        "subscription_data[metadata][subject_id]": guest.subject_id,
        "success_url": origin + "/pay/success",
        "cancel_url": origin + "/pay/canceled",
    }
    if settings.stripe_trial_days:
        data["subscription_data[trial_period_days]"] = settings.stripe_trial_days
    return {"url": stripe(settings, "POST", "checkout/sessions", data)["url"]}


def portal(settings, guest, origin):
    require_billing(settings)
    customer = (guest.data.get("subscription") or {}).get("customer")
    if not customer:
        fail(404, "subscription_not_found", "There is no subscription to manage.")
    data = {"customer": customer, "return_url": origin + "/settings"}
    return {"url": stripe(settings, "POST", "billing_portal/sessions", data)["url"]}


def cancel(settings, guest):
    """Called before guest deletion so a deleted session never keeps renewing."""
    sub = guest.data.get("subscription") or {}
    if settings.billing_provider != "none" and sub.get("id") and sub.get("status") != "canceled":
        stripe(settings, "DELETE", "subscriptions/" + sub["id"])


def view(settings, guest):
    if settings.billing_provider == "none":
        return None
    sub = guest.data.get("subscription") or {}
    return {k: sub.get(k) for k in ("status", "plan", "current_period_end", "cancel_at_period_end")} | {
        "test_mode": True
    }


def verify(secret, payload, header, now=None, tolerance=300):
    parts = [p.split("=", 1) for p in header.split(",") if "=" in p]
    ts = next((v for k, v in parts if k == "t"), "")
    signed = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    ok = ts.isdigit() and abs((now or time.time()) - int(ts)) <= tolerance
    if not ok or not any(k == "v1" and hmac.compare_digest(v, signed) for k, v in parts):
        fail(400, "invalid_signature", "Invalid webhook signature.")
    return json.loads(payload)


def apply_event(db, event):
    if not event["type"].startswith("customer.subscription."):
        return
    sub = event["data"]["object"]
    subject = (sub.get("metadata") or {}).get("subject_id")
    guest = subject and db.scalar(select(Guest).where(Guest.subject_id == subject).with_for_update())
    if not guest:
        return  # guest deleted or a subscription made outside this app
    data = dict(guest.data)
    if (data.get("subscription") or {}).get("event_created", 0) > event["created"]:
        return  # Stripe does not guarantee order; keep the newer state
    item = sub["items"]["data"][0]
    data["subscription"] = {
        "id": sub["id"],
        "customer": sub["customer"],
        "status": sub["status"],
        "plan": item["price"]["recurring"]["interval"],
        # API 2025-03+ moved the period to the item.
        "current_period_end": sub.get("current_period_end") or item.get("current_period_end"),
        "cancel_at_period_end": sub.get("cancel_at_period_end", False),
        "event_created": event["created"],
    }
    guest.data = data
