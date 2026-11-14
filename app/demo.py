"""One-click mock data for the current guest (DEMO_MODE only). Replaces the guest's resources."""

from datetime import timedelta

from sqlalchemy import delete

from app.audio import metric
from app.content import generate_plan, interpret, protocol
from app.db import Idempotency, Job, Resource, iso, new_id, utcnow
from app.worker import MEASUREMENT_VERSION

CONDITIONS = {"device_label": "Demo microphone", "distance_cm": 20, "environment": "quiet_room", "notes": None}


def measurements(wpm, pause_ratio, semitones, f0):
    return {
        "f0_median_hz": metric(f0, "Hz"),
        "f0_range_hz": metric({"p10": round(f0 * 0.8, 2), "p90": round(f0 * 1.3, 2)}, "Hz"),
        "f0_timeline": {
            "available": True,
            "unavailable_reason": None,
            "unit": "Hz",
            "points": [{"time_seconds": round(i * 0.5, 3), "value": round(f0 + 15 * ((i % 7) - 3), 2)} for i in range(60)],
        },
        "pause_count": metric(18, "count"),
        "pause_total_seconds": metric(round(pause_ratio * 60, 3), "s"),
        "pause_ratio": metric(pause_ratio, "ratio"),
        "speaking_rate_wpm": metric(wpm, "words/min"),
        "articulation_rate_wpm": metric(round(wpm / (1 - pause_ratio), 2), "words/min"),
        "intonation_range_semitones": metric(semitones, "semitones"),
    }


REPORT = {
    "summary": "Your pace is a little quick and pauses are short. Slow down slightly and let sentences land.",
    "observations": [
        {"category": "pace", "text": "You read at about 168 words per minute, above your 130–160 target.", "source": "audio_model"},
        {"category": "pauses", "text": "Pauses take 11 % of the reading, below the 14–22 % target.", "source": "audio_model"},
    ],
    "limitations": ["Demo data, not a real analysis."],
    "priorities": [
        {"tag": "pace", "reason": "Pace is above the target range.", "exercise_ids": ["E06"]},
        {"tag": "pauses", "reason": "Pauses are shorter than the target.", "exercise_ids": ["E07"]},
    ],
    "recommended_exercise_ids": ["E06", "E07"],
}


def seed(s):
    g = s.auth()
    for model in (Resource, Job, Idempotency):
        s.db.execute(delete(model).where(model.guest_id == g.id))
    goal, tz = g.data["preferences"]["goal"], g.data["preferences"]["timezone"]
    now, previous = utcnow(), None
    # ponytail: no recordings/audio files seeded; progress shows an empty recordings list
    for days_ago, m, kind in (
        (22, measurements(176.0, 0.09, 4.1, 182.0), "initial"),
        (7, measurements(168.0, 0.11, 5.3, 179.0), "reassessment"),
    ):
        at = iso(now - timedelta(days=days_ago))
        a = {
            "id": new_id(), "kind": kind, "status": "completed", "created_at": at, "completed_at": at,
            "goal": goal, "timezone": tz, "protocol_version": "assessment-v2",
            "previous_assessment_id": previous["id"] if previous else None,
            "recording_conditions": CONDITIONS, "tasks": protocol(previous, 0 if not previous else 1),
            "max_total_duration_seconds": 180, "job_id": None, "demo_override_used": False,
            "recordings": [], "measurements": m, "report": REPORT, "comparison": None,
            "interpretation": interpret(goal, m, previous and previous["measurements"]),
            "analysis_metadata": {"protocol_version": "assessment-v2", "measurement_version": MEASUREMENT_VERSION,
                                  "demo": {"enabled": True, "date_override_used": False, "prepared_data": True}},
        }
        p = generate_plan(a, REPORT, 2 if previous else 1)
        p["created_at"] = at
        if previous:
            for day, lesson in enumerate(p["lessons"][:6]):
                done = now - timedelta(days=6 - day)
                for item in lesson["items"]:
                    attempt = {
                        "id": new_id(), "plan_item_id": item["id"], "exercise_id": item["exercise_id"],
                        "status": "passed", "verification_type": "self_confirmation", "self_confirmed": True,
                        "elapsed_seconds": None, "recording_id": None, "created_at": iso(done), "completed_at": iso(done),
                        "plan_item_status": "completed", "practice_seconds": item["estimated_duration_seconds"],
                        "reward": {"notes": 3, "parts": [{"notes": 3, "reason": "exercise_completed"}]},
                        "feedback": {"summary": "Practice completed.", "metrics": None, "issues": []},
                    }
                    s.put("attempt", attempt)
                    item.update(status="completed", completed_at=iso(done), latest_attempt_id=attempt["id"])
                lesson.update(status="completed", completed_at=iso(done), timezone=tz,
                              completed_on=s.local_date(iso(done)).isoformat())
            p["completed_lessons"] = 6
        else:
            p["status"] = "archived"
        a["plan_id"] = p["id"]
        s.put("plan", p)
        s.put("assessment", a)
        previous = a
    a["next_reassessment"] = s.reassessment()
    s.put("assessment", a)
    return s.me()
