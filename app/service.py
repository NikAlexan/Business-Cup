import copy
import hashlib
import json
import shutil
from datetime import date, datetime, timedelta
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import select

from app.access import NoBillingAccessPolicy
from app.coaching import listening_intent_policy, next_action_intent
from app.content import protocol
from app.db import DailyBudget, Guest, Idempotency, Job, Resource, iso, new_id, utcnow
from app.errors import ApiError, fail
from app.focus import KEEP_STEPS, RUBRIC_VERSION, RUBRICS, STORY_STEPS, suggested_skill
from app.listening import CATALOG as LISTENING_CATALOG
from app.listening import boundaries, example_for, listening_words

COOKIE = "guest_session"
ACTIVE = {"draft", "queued", "processing", "needs_rerecord"}
TERMINAL = {"completed", "needs_rerecord", "failed"}


def notes_for(item):
    return (2 if item["exercise_id"] == "E01" else 3) + (item["task"]["verification"]["type"] == "recording")


def annotate_notes(lesson):
    for item in lesson["items"]:
        item["notes_available"] = notes_for(item)
    return lesson


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Service:
    def __init__(self, db, settings, cookie=None, write=False):
        self.db, self.settings = db, settings
        self.signer = URLSafeTimedSerializer(settings.app_secret.get_secret_value(), salt="voice-guest-v1")
        self.guest = None
        self.policy = NoBillingAccessPolicy()
        if cookie:
            try:
                gid = self.signer.loads(cookie, max_age=31536000)
                query = select(Guest).where(Guest.id == gid)
                if write:
                    query = query.with_for_update()
                self.guest = db.scalar(query)
                if self.guest:
                    self.guest.data = copy.deepcopy(self.guest.data)
            except BadSignature:
                pass

    def auth(self, capability=None):
        if not self.guest:
            fail(401, "session_required", "Create a guest session first.")
        if capability and not self.policy.check_access(self.guest.subject_id, capability):
            fail(403, "access_denied", "This capability is not available.")
        return self.guest

    def all(self, kind):
        self.auth()
        rows = self.db.scalars(
            select(Resource)
            .where(Resource.guest_id == self.guest.id, Resource.kind == kind)
            .order_by(Resource.created_at, Resource.id)
        ).all()
        return [copy.deepcopy(r.data) for r in rows]

    def get(self, rid, kind):
        self.auth()
        row = self.db.scalar(
            select(Resource).where(
                Resource.id == str(rid), Resource.kind == kind, Resource.guest_id == self.guest.id
            )
        )
        if not row:
            fail(404, "not_found", f"{kind.replace('_', ' ').capitalize()} not found.")
        return copy.deepcopy(row.data)

    def put(self, kind, data):
        row = self.db.get(Resource, data["id"])
        if row:
            if row.guest_id != self.guest.id or row.kind != kind:
                fail(404, "not_found", "Resource not found.")
            row.data = copy.deepcopy(data)
        else:
            self.db.add(
                Resource(
                    id=data["id"],
                    guest_id=self.guest.id,
                    kind=kind,
                    created_at=data.get("created_at", iso()),
                    data=copy.deepcopy(data),
                )
            )
        self.db.flush()
        return data

    def local_date(self, timestamp=None):
        tz = ZoneInfo(self.guest.data["preferences"]["timezone"])
        return (
            (datetime.fromisoformat(timestamp.replace("Z", "+00:00")) if timestamp else utcnow())
            .astimezone(tz)
            .date()
        )

    def assessments(self):
        return sorted(self.all("assessment"), key=lambda a: (a["created_at"], a["id"]))

    def latest_assessment(self):
        done = [a for a in self.assessments() if a["status"] == "completed"]
        return max(done, key=lambda a: a["completed_at"]) if done else None

    def reassessment(self):
        previous = self.latest_assessment()
        next_on = (
            self.local_date(previous["completed_at"]) + timedelta(days=self.settings.reassessment_days)
            if previous
            else None
        )
        return {
            "next_available_on": next_on.isoformat() if next_on else None,
            "timezone": self.guest.data["preferences"]["timezone"],
            "available": bool(next_on and self.local_date() >= next_on),
            "demo_override_available": bool(self.settings.demo_mode and previous),
        }

    def streak(self):
        dates = sorted(
            {
                date.fromisoformat(x["completed_on"])
                for p in self.all("plan")
                for x in p["lessons"]
                if x["completed_at"]
            }
        )
        longest = run = 0
        for i, day in enumerate(dates):
            run = run + 1 if i and day == dates[i - 1] + timedelta(days=1) else 1
            longest = max(longest, run)
        current = run if dates and dates[-1] >= self.local_date() - timedelta(days=1) else 0
        return {
            "current_days": current,
            "longest_days": longest,
            "last_practice_on": dates[-1].isoformat() if dates else None,
        }

    def guest_view(self):
        s = self.settings
        return {
            "guest_id": self.guest.id,
            "subject_id": self.guest.subject_id,
            **self.guest.data,
            "demo_mode": s.demo_mode,
            "limits": {
                "max_file_bytes": s.max_file_bytes,
                "max_recording_seconds": s.max_recording_seconds,
                "max_assessment_total_seconds": 180,
                "accepted_audio_types": ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"],
            },
        }

    def plan(self, required=True):
        plans = [p for p in self.all("plan") if p["status"] in ("active", "completed")]
        p = max(plans, key=lambda x: x["version"]) if plans else None
        if p:
            self.unlock(p)
        elif required:
            fail(404, "plan_not_found", "Complete your initial assessment to get a plan.")
        return p

    def unlock(self, p):
        already_trained = any(
            lesson.get("completed_on") == self.local_date().isoformat()
            for plan in self.all("plan")
            for lesson in plan["lessons"]
        )
        for lesson in p["lessons"]:
            annotate_notes(lesson)
        for i, lesson in enumerate(p["lessons"]):
            if lesson["status"] == "completed":
                continue
            ready = i == 0 or (
                p["lessons"][i - 1]["status"] == "completed"
                and self.local_date() > date.fromisoformat(p["lessons"][i - 1]["completed_on"])
            )
            if already_trained:
                lesson["status"] = "locked"
            elif ready:
                lesson["status"] = (
                    "in_progress"
                    if any(x["latest_attempt_id"] is not None for x in lesson["items"])
                    else "available"
                )
            break
        return p

    def rewards(self, item_ids=None):
        passed = [
            a
            for a in self.all("attempt")
            if a["status"] == "passed" and (item_ids is None or a["plan_item_id"] in item_ids)
        ]
        return {
            "notes_total": sum(a.get("reward", {}).get("notes", 0) for a in passed),
            "practice_seconds_total": sum(
                a.get("practice_seconds", 0)
                for a in passed
                if a.get("verification_type") != "self_confirmation"
            ),
            "rules_version": 2,
        }

    def me(self):
        self.auth()
        p = self.plan(False)
        previous = self.latest_assessment()
        active = next((a for a in reversed(self.assessments()) if a["status"] in ACTIVE), None)
        streak = self.streak()
        return {
            **self.guest_view(),
            "onboarding_status": "assessment_in_progress"
            if active
            else ("ready" if previous else "needs_assessment"),
            "data_provenance": {
                "prepared_demo_history": any(
                    a.get("analysis_metadata", {}).get("demo", {}).get("prepared_data", False)
                    for a in self.assessments()
                )
            },
            "active_assessment_id": active["id"] if active else None,
            "latest_assessment_id": previous["id"] if previous else None,
            "current_plan_id": p["id"] if p else None,
            "reassessment": self.reassessment(),
            "capabilities": {
                "exercise_coaching": bool(
                    self.settings.exercise_reviews_enabled and self.settings.openai_api_key.get_secret_value()
                ),
                **{
                    c: self.policy.check_access(self.guest.subject_id, c)
                    for c in ("assessment", "daily_training")
                },
            },
            "progress": {
                "completed_lessons": p["completed_lessons"] if p else 0,
                "total_lessons": p["total_lessons"] if p else 0,
                "current_streak_days": streak["current_days"],
                "longest_streak_days": streak["longest_days"],
                **self.rewards(),
            },
        }

    def mutate(self, key, method, path, payload, fn):
        self.auth()
        scope = digest(self.guest.id + method + path + key)
        fingerprint = digest(json.dumps(payload, sort_keys=True, separators=(",", ":")))
        prior = self.db.get(Idempotency, scope)
        if prior:
            if prior.fingerprint != fingerprint:
                fail(409, "idempotency_conflict", "This key was used with a different request.")
            return prior.status, copy.deepcopy(prior.data)
        status, data = fn()
        self.db.add(
            Idempotency(
                id=scope,
                guest_id=self.guest.id,
                fingerprint=fingerprint,
                status=status,
                data=copy.deepcopy(data),
            )
        )
        self.db.flush()
        return status, data

    def create_assessment(self, payload):
        self.auth("assessment")
        active = next((a for a in self.assessments() if a["status"] in ACTIVE), None)
        if active:
            fail(
                409,
                "assessment_in_progress",
                "Resume the active assessment.",
                {"assessment_id": active["id"]},
            )
        previous = self.latest_assessment()
        demo = payload["demo_override"]
        if demo and not self.settings.demo_mode:
            fail(403, "demo_mode_disabled", "Demo override is not enabled.")
        if payload["kind"] == "initial" and previous:
            fail(409, "initial_assessment_exists", "Use reassessment.", {"assessment_id": previous["id"]})
        if payload["kind"] == "reassessment":
            if not previous:
                fail(409, "initial_assessment_required", "Complete your initial assessment first.")
            if not self.reassessment()["available"] and not demo:
                fail(
                    409,
                    "reassessment_not_available",
                    "Your next assessment is not available yet.",
                    self.reassessment(),
                )
        a = {
            "id": new_id(),
            "kind": payload["kind"],
            "status": "draft",
            "created_at": iso(),
            "goal": self.guest.data["preferences"]["goal"],
            "timezone": self.guest.data["preferences"]["timezone"],
            "protocol_version": "assessment-v2",
            "previous_assessment_id": previous["id"] if previous else None,
            "recording_conditions": payload["recording_conditions"],
            "tasks": protocol(previous, len(self.assessments())),
            "max_total_duration_seconds": 180,
            "job_id": None,
            "report": None,
            "plan_id": None,
            "demo_override_used": demo,
        }
        return 201, self.put("assessment", a)

    def queue(self, kind, assessment_id=None, recording_id=None, attempt_id=None):
        data = {
            "id": new_id(),
            "type": kind,
            "status": "queued",
            "assessment_id": assessment_id,
            "recording_id": recording_id,
            "attempt_count": 0,
            "max_attempts": self.settings.job_max_attempts,
            "created_at": iso(),
            "updated_at": iso(),
            "poll_after_ms": 2000,
            "stage": "queued",
            "result": None,
            "error": None,
            "retryable": False,
            "retry_batches": 0,
        }
        if attempt_id:
            data["attempt_id"] = attempt_id
        self.db.add(Job(id=data["id"], guest_id=self.guest.id, status="queued", data=data))
        self.db.flush()
        return data

    def job(self, jid):
        self.auth()
        row = self.db.scalar(select(Job).where(Job.id == str(jid), Job.guest_id == self.guest.id))
        if not row:
            fail(404, "not_found", "Job not found.")
        return row

    def submit(self, aid):
        a = self.get(aid, "assessment")
        if a["status"] in ("queued", "processing", "completed"):
            j = self.job(a["job_id"])
            return 202, {
                "assessment_id": a["id"],
                "status": j.status,
                "job_id": j.id,
                "poll_after_ms": None if j.status in TERMINAL else 2000,
            }
        if a["status"] == "failed":
            fail(409, "job_not_retryable", "Use the job retry endpoint if retry is available.")
        missing, pending, rejected = [], [], []
        for task in a["tasks"]:
            if task.get("pending_recording_id"):
                pending.append(task["id"])
            elif not task["recording_id"]:
                missing.append(task["id"])
            elif task["quality_status"] != "accepted":
                rejected.append(task["id"])
        if missing or pending or rejected:
            fail(
                409,
                "assessment_not_ready",
                "All three tasks need accepted recordings.",
                {"missing_task_ids": missing, "pending_task_ids": pending, "rejected_task_ids": rejected},
            )
        seconds = sum(self.get(t["recording_id"], "recording")["duration_seconds"] for t in a["tasks"])
        if seconds > 180:
            fail(
                422,
                "assessment_duration_exceeded",
                "Total audio must not exceed 180 seconds.",
                {"total_seconds": seconds, "max_seconds": 180},
            )
        used = [
            j
            for j in self.db.scalars(select(Job).where(Job.guest_id == self.guest.id)).all()
            if j.data["type"] == "assessment_analysis"
            and self.local_date(j.data["created_at"]) == self.local_date()
        ]
        if len(used) >= self.settings.max_assessments_per_day:
            fail(429, "rate_limit_exceeded", "Daily assessment limit reached.", {"retry_after_seconds": 3600})
        self.consume_budget("assessments", self.settings.max_total_assessments_per_day)
        j = self.queue("assessment_analysis", assessment_id=a["id"])
        a.update(status="queued", job_id=j["id"])
        self.put("assessment", a)
        return 202, {"assessment_id": a["id"], "status": "queued", "job_id": j["id"], "poll_after_ms": 2000}

    def consume_budget(self, kind, maximum):
        if self.db.bind.dialect.name == "postgresql":
            from sqlalchemy import text

            self.db.execute(text("SELECT pg_advisory_xact_lock(823114710)"))
        key = kind + ":" + iso()[:10]
        counter = self.db.get(DailyBudget, key)
        if counter is None:
            counter = DailyBudget(id=key, count=0)
            self.db.add(counter)
        if counter.count >= maximum:
            fail(
                429,
                "rate_limit_exceeded",
                "Service daily processing budget reached.",
                {"retry_after_seconds": 3600},
            )
        counter.count += 1
        self.db.flush()

    def retry_job(self, jid):
        j = self.job(jid)
        d = copy.deepcopy(j.data)
        if j.status in ("queued", "processing") and d["retry_batches"]:
            return 202, {"job_id": j.id, "status": j.status, "poll_after_ms": 2000}
        if (
            j.status != "failed"
            or not d["retryable"]
            or d["retry_batches"] >= self.settings.job_max_retry_batches
        ):
            fail(409, "job_not_retryable", "This job cannot be retried.")
        d.update(
            status="queued",
            stage="queued",
            error=None,
            result=None,
            retryable=False,
            poll_after_ms=2000,
            updated_at=iso(),
            retry_batches=d["retry_batches"] + 1,
            max_attempts=d["max_attempts"] + self.settings.job_max_attempts,
        )
        if d["type"] == "recording_check":
            rec = self.get(d["recording_id"], "recording")
            if rec["assessment_id"]:
                a = self.get(rec["assessment_id"], "assessment")
                task = next(t for t in a["tasks"] if t["id"] == rec["task_id"])
                if task.get("last_upload_id") != rec["id"]:
                    fail(409, "recording_superseded", "A newer recording has replaced this upload.")
                task["pending_recording_id"] = rec["id"]
                self.put("assessment", a)
            rec["status"] = "queued"
            self.put("recording", rec)
        j.status, j.data, j.lease_until, j.lease_token = "queued", d, None, None
        if d["type"] == "exercise_review":
            a = self.get(d["attempt_id"], "attempt")
            a["speech_review"].update(status="queued", error=None)
            self.put("attempt", a)
        if d["assessment_id"] and d["type"] == "assessment_analysis":
            a = self.get(d["assessment_id"], "assessment")
            a["status"] = "queued"
            self.put("assessment", a)
        return 202, {"job_id": j.id, "status": "queued", "poll_after_ms": 2000}

    def start_speech_review(self, attempt):
        """Coaching availability never changes audio acceptance or completion credit."""
        unavailable = {"status": "unavailable", "job_id": None, "report": None}
        if not self.settings.exercise_reviews_enabled or not self.settings.openai_api_key.get_secret_value():
            return {**unavailable, "reason": "not_configured"}
        if (
            sum(
                j.data["type"] == "exercise_review"
                and self.local_date(j.data["created_at"]) == self.local_date()
                for j in self.db.scalars(select(Job).where(Job.guest_id == self.guest.id))
            )
            >= self.settings.max_exercise_reviews_per_day
        ):
            return {**unavailable, "reason": "daily_limit"}
        try:
            self.consume_budget("exercise_reviews", self.settings.max_total_exercise_reviews_per_day)
        except ApiError as exc:
            if exc.status != 429:
                raise
            return {**unavailable, "reason": "service_daily_limit"}
        job = self.queue("exercise_review", attempt_id=attempt["id"])
        return {
            "version": "exercise-review-v1",
            "status": "queued",
            "job_id": job["id"],
            "report": None,
            "goal": self.guest.data["preferences"]["goal"],
            "requested_at": iso(),
        }

    def request_speech_review(self, attempt_id):
        self.auth("daily_training")
        attempt = self.get(attempt_id, "attempt")
        if attempt["status"] != "passed" or not attempt.get("recording_id"):
            fail(422, "review_not_available", "Speech coaching needs a saved, accepted recording.")
        previous = attempt.get("speech_review")
        if not previous or previous["status"] == "unavailable":
            attempt["speech_review"] = self.start_speech_review(attempt)
            self.put("attempt", attempt)
        return 200, attempt

    def find_item(self, item_id, writable=False, practice_only=False):
        for p in self.all("plan"):
            self.unlock(p)
            for lesson in p["lessons"]:
                for item in lesson["items"]:
                    if item["id"] == str(item_id):
                        if practice_only:
                            if item["status"] != "completed":
                                fail(
                                    409,
                                    "exercise_not_completed",
                                    "Complete this exercise before extra practice.",
                                )
                        elif writable:
                            if p["status"] != "active":
                                fail(409, "plan_inactive", "This plan is no longer active.")
                            if item["status"] == "completed":
                                fail(
                                    409,
                                    "plan_item_already_completed",
                                    "This exercise is already complete.",
                                    {"attempt_id": item["latest_attempt_id"]},
                                )
                            if lesson["status"] == "locked":
                                fail(409, "lesson_locked", "This lesson is not available yet.")
                        return p, lesson, item
        fail(404, "not_found", "Plan item not found.")

    def recording_check_state(self, record):
        job_id = record.get("check_job_id")
        if not job_id:  # Legacy uploads did not persist the job pointer.
            job_id = next(
                (
                    j.id
                    for j in self.db.scalars(select(Job).where(Job.guest_id == self.guest.id))
                    if j.data.get("recording_id") == record["id"] and j.data["type"] == "recording_check"
                ),
                None,
            )
        return (
            {
                "recording_id": record["id"],
                "job_id": job_id,
                "practice_only": bool(record.get("practice_only")),
                "based_on_attempt_id": (record.get("practice_focus") or {}).get("attempt_id"),
                "practice_focus": record.get("practice_focus"),
                "training_focus": record.get("training_focus"),
                "listening_plan": record.get("listening_plan"),
                "status": record["status"],
            }
            if job_id
            else None
        )

    def assessment_state(self, assessment_id):
        assessment = self.get(assessment_id, "assessment")
        records = {r["id"]: r for r in self.all("recording") if r.get("assessment_id") == assessment["id"]}
        for task in assessment["tasks"]:
            task["pending_take"] = None
            record = records.get(task.get("pending_recording_id") or task.get("last_upload_id"))
            if record and record["status"] in ("queued", "processing", "failed"):
                if record["status"] != "failed" or task.get("quality_status") != "accepted":
                    task["pending_take"] = self.recording_check_state(record)
        return assessment

    def item_state(self, item_id):
        plan, lesson, item = self.find_item(item_id)
        attempted = {a.get("recording_id") for a in self.all("attempt") if a["plan_item_id"] == item["id"]}
        canceled = {c["result"].get("recording_id") for c in self.all("upload_cancellation")}
        records = [
            r
            for r in self.all("recording")
            if r["purpose"] == "exercise"
            and r["plan_item_id"] == item["id"]
            and r["id"] not in attempted
            and r["id"] not in canceled
            and not r.get("dismissed_at")
            and bool(r.get("practice_only")) == (item["status"] == "completed")
        ]
        pending = None
        if records:
            record = max(records, key=lambda r: (r["created_at"], r["id"]))
            pending = self.recording_check_state(record)
        return {
            "plan_id": plan["id"],
            "plan_status": plan["status"],
            "lesson": lesson,
            "item": item,
            "item_index": next(n for n, value in enumerate(lesson["items"]) if value["id"] == item["id"]),
            "pending_take": pending,
            "training_focus": self.active_practice_focus() if item["exercise_id"] == "E12" else None,
            "listening_example": example_for(item["exercise_id"]),
            "listening_boundaries": boundaries(item["task"]) if item["exercise_id"] == "E08" else [],
            "listening_plan": max(
                (p for p in self.all("listening_plan") if p["plan_item_id"] == item["id"]),
                key=lambda p: (p["created_at"], p["id"]),
                default=None,
            ),
        }

    def dismiss_recording(self, recording_id):
        record = self.get(recording_id, "recording")
        if record["purpose"] != "exercise":
            fail(422, "validation_error", "Only an unfinished exercise take can be dismissed.")
        if any(a.get("recording_id") == record["id"] for a in self.all("attempt")):
            fail(409, "recording_already_used", "This take is already part of your history.")
        if not record.get("dismissed_at"):
            record["dismissed_at"] = iso()
            self.put("recording", record)
        return {"recording_id": record["id"], "dismissed_at": record["dismissed_at"]}

    def practice_source(self, source_id, item_id, practice_only):
        if not source_id:
            return None
        if not practice_only:
            fail(422, "validation_error", "A previous-take focus applies only to extra practice.")
        source = self.get(source_id, "attempt")
        if source["plan_item_id"] != item_id:
            fail(404, "not_found", "The source take does not belong to this exercise.")
        reflection = source.get("reflection") or {}
        return {
            "attempt_id": source["id"],
            "note": reflection.get("note", ""),
            **({"intent": reflection["intent"]} if reflection.get("intent") else {}),
        }

    def save_listening_plan(self, item_id, payload):
        self.auth("daily_training")
        _, _, item = self.find_item(item_id)
        example = LISTENING_CATALOG["examples"].get(payload["example_id"])
        options = boundaries(item["task"]) if item["exercise_id"] == "E08" else []
        if not example or example["exercise_id"] != item["exercise_id"] or not options:
            fail(422, "listening_example_unavailable", "This example does not apply to the saved exercise.")
        if payload["boundary_index"] >= len(options):
            fail(422, "invalid_listening_boundary", "Choose a marked boundary in your assigned text.")
        if (
            sum(self.local_date(p["created_at"]) == self.local_date() for p in self.all("listening_plan"))
            >= self.settings.max_uploads_per_day
        ):
            fail(
                429,
                "rate_limit_exceeded",
                "Daily listening-plan limit reached.",
                {"retry_after_seconds": 3600},
            )
        boundary = options[payload["boundary_index"]]
        plan = {
            "id": new_id(),
            "plan_item_id": item["id"],
            "created_at": iso(),
            "example": copy.deepcopy(example),
            "answer": payload["answer"],
            "source": "user_listening",
            "boundary_index": boundary["index"],
            "boundary_word_index": boundary["word_index"],
            "before": boundary["before"],
            "after": boundary["after"],
            "expected_words": listening_words(item["task"]["text"]),
        }
        return 201, self.put("listening_plan", plan)

    def save_reflection(self, attempt, payload):
        previous = attempt.get("reflection") or {}
        reflection = {**previous, "note": payload["note"].strip()}
        if payload.get("intent") is not None:
            reflection["intent"] = payload["intent"]
        changed = reflection != previous
        if changed:
            attempt["reflection"] = {**reflection, "updated_at": iso()}
        review = attempt.get("speech_review")
        if review and review.get("report"):
            report = listening_intent_policy(review["report"], next_action_intent(attempt))
            if report != review["report"]:
                review["report"] = report
                changed = True
        if changed:
            self.put("attempt", attempt)
        return attempt

    def active_practice_focus(self):
        self.auth()
        focus_id = self.guest.data.get("practice_focus_id")
        return self.get(focus_id, "practice_focus") if focus_id else None

    def practice_focus_view(self):
        focus = self.active_practice_focus()
        checks = (
            [
                a
                for a in self.all("attempt")
                if (a.get("training_focus") or {}).get("id") == focus["id"] and a.get("focus_check")
            ]
            if focus
            else []
        )
        latest = max(checks, key=lambda a: a["focus_check"]["updated_at"]) if checks else None
        return {
            "focus": focus,
            "skills": RUBRICS,
            "last_check": {"attempt_id": latest["id"], **latest["focus_check"]} if latest else None,
        }

    def save_practice_focus(self, payload):
        self.auth("daily_training")
        source = self.get(payload["source_attempt_id"], "attempt")
        if source["status"] != "passed" or not source.get("recording_id"):
            fail(
                422, "focus_source_not_available", "Choose a saved, accepted recording for your story focus."
            )
        note = payload["note"].strip()
        if not note:
            fail(422, "validation_error", "Describe one experiment or a feature to keep in the story.")
        if (
            sum(self.local_date(f["created_at"]) == self.local_date() for f in self.all("practice_focus"))
            >= self.settings.max_uploads_per_day
        ):
            fail(
                429, "rate_limit_exceeded", "Daily focus-change limit reached.", {"retry_after_seconds": 3600}
            )
        intent = payload.get("intent") or source.get("reflection", {}).get("intent") or "experiment"
        if intent == "undecided":
            fail(
                422,
                "focus_intent_required",
                "Choose an experiment or a feature to keep before saving a story focus.",
            )
        skill = payload.get("skill") or suggested_skill(source["exercise_id"])
        focus = {
            "id": new_id(),
            "created_at": iso(),
            "note": note,
            "skill": skill,
            "skill_label": RUBRICS[skill]["label"],
            "listening_question": RUBRICS[skill]["question"],
            "steps": list(KEEP_STEPS if intent == "keep" else STORY_STEPS),
            "intent": intent,
            "rubric_version": RUBRIC_VERSION,
            "source_attempt_id": source["id"],
            "source_plan_item_id": source["plan_item_id"],
            "source_recording_id": source["recording_id"],
        }
        self.put("practice_focus", focus)
        self.guest.data = {**self.guest.data, "practice_focus_id": focus["id"]}
        self.save_reflection(source, {"note": note, "intent": intent})
        return 201, {"focus": focus, "source_attempt": source}

    def clear_practice_focus(self, focus_id):
        self.get(focus_id, "practice_focus")
        if self.guest.data.get("practice_focus_id") == str(focus_id):
            self.guest.data = {**self.guest.data, "practice_focus_id": None}

    def save_focus_check(self, attempt_id, outcome):
        attempt = self.get(attempt_id, "attempt")
        if attempt["status"] != "passed" or not attempt.get("training_focus"):
            fail(422, "focus_check_not_available", "This take does not have a saved story focus.")
        if attempt.get("focus_check", {}).get("outcome") != outcome:
            attempt["focus_check"] = {"outcome": outcome, "source": "user_listening", "updated_at": iso()}
            self.put("attempt", attempt)
        return attempt

    def cancel_upload(self, upload_key, item_id):
        self.auth("daily_training")
        self.find_item(item_id, practice_only=True)
        cancel_id = str(uuid5(UUID(self.guest.id), "cancel-upload:" + upload_key))
        existing = self.db.get(Resource, cancel_id)
        if existing:
            if existing.data["plan_item_id"] != str(item_id):
                fail(409, "upload_cancellation_conflict", "This upload key belongs to another exercise.")
            return existing.data["result"]
        prior = self.db.get(Idempotency, digest(self.guest.id + "POST/api/v1/recordings" + upload_key))
        recording_id = None
        if prior:
            recording_id = prior.data.get("recording", {}).get("id")
            record = self.get(recording_id, "recording")
            if record.get("plan_item_id") != str(item_id) or not record.get("practice_only"):
                fail(404, "not_found", "Extra-practice upload not found for this exercise.")
            self.dismiss_recording(recording_id)
        elif (
            sum(
                self.local_date(c["created_at"]) == self.local_date() for c in self.all("upload_cancellation")
            )
            >= self.settings.max_uploads_per_day
        ):
            fail(
                429,
                "rate_limit_exceeded",
                "Daily upload cancellation limit reached.",
                {"retry_after_seconds": 3600},
            )
        result = {"upload_key": upload_key, "status": "canceled", "recording_id": recording_id}
        self.put(
            "upload_cancellation",
            {"id": cancel_id, "plan_item_id": str(item_id), "created_at": iso(), "result": result},
        )
        return result

    def upload(self, upload, fields, mime_type, upload_key=None):
        self.auth("daily_training" if fields["purpose"] == "exercise" else "assessment")
        if upload_key and self.db.get(
            Resource, str(uuid5(UUID(self.guest.id), "cancel-upload:" + upload_key))
        ):
            fail(409, "upload_canceled", "This upload was canceled. Record a new take to practice again.")
        purpose = fields["purpose"]
        a = task = item = None
        if purpose == "assessment":
            if fields.get("practice_only") or fields.get("based_on_attempt_id"):
                fail(422, "validation_error", "Extra practice applies only to completed exercises.")
            if not fields["assessment_id"] or not fields["task_id"] or fields["plan_item_id"]:
                fail(422, "validation_error", "Assessment upload requires only assessment_id and task_id.")
            a = self.get(fields["assessment_id"], "assessment")
            if a["status"] not in ("draft", "needs_rerecord"):
                fail(409, "assessment_locked", "Recordings cannot be changed now.")
            task = next((t for t in a["tasks"] if t["id"] == fields["task_id"]), None)
            if not task:
                fail(404, "not_found", "Task not found in this assessment.")
            if task.get("pending_recording_id"):
                fail(409, "recording_check_in_progress", "Wait for the current recording check.")
        else:
            if not fields["plan_item_id"] or fields["assessment_id"] or fields["task_id"]:
                fail(422, "validation_error", "Exercise upload requires only plan_item_id.")
            _, _, item = self.find_item(
                fields["plan_item_id"], writable=True, practice_only=fields.get("practice_only", False)
            )
            if item["task"]["verification"]["type"] != "recording":
                fail(422, "validation_error", "This exercise does not accept recordings.")
        practice_focus = self.practice_source(
            fields.get("based_on_attempt_id"),
            item["id"] if item else None,
            fields.get("practice_only", False),
        )
        training_focus = None
        if fields.get("training_focus_id"):
            if not item or item["exercise_id"] != "E12":
                fail(422, "validation_error", "A saved story focus applies only to a narration task.")
            training_focus = self.get(fields["training_focus_id"], "practice_focus")
        listening_plan = None
        if fields.get("listening_plan_id"):
            listening_plan = self.get(fields["listening_plan_id"], "listening_plan")
            if not item or item["exercise_id"] != "E08" or listening_plan["plan_item_id"] != item["id"]:
                fail(404, "not_found", "Listening plan not found for this exercise.")
        used = sum(self.local_date(r["created_at"]) == self.local_date() for r in self.all("recording"))
        if used >= self.settings.max_uploads_per_day:
            fail(429, "rate_limit_exceeded", "Daily recording limit reached.", {"retry_after_seconds": 3600})
        self.consume_budget("uploads", self.settings.max_total_uploads_per_day)
        rid = new_id()
        directory = self.settings.audio_data / self.guest.id
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / rid
        # The API computes the hash before calling this function for idempotency.
        upload.file.seek(0)
        try:
            with path.open("xb") as out:
                shutil.copyfileobj(upload.file, out, length=1024 * 1024)
            self.rollback_files.append(path)
            data = {
                "id": rid,
                **fields,
                "practice_focus": practice_focus,
                "training_focus": training_focus,
                "listening_plan": listening_plan,
                "status": "queued",
                "mime_type": mime_type,
                "bytes": path.stat().st_size,
                "duration_seconds": None,
                "created_at": iso(),
                "quality": None,
                "audio_url": f"/api/v1/recordings/{rid}/audio",
            }
            self.put("recording", data)
            if task:
                task["pending_recording_id"] = rid
                task["last_upload_id"] = rid
                self.put("assessment", a)
            j = self.queue("recording_check", assessment_id=fields["assessment_id"], recording_id=rid)
            data["check_job_id"] = j["id"]
            self.put("recording", data)
            return 202, {"recording": data, "job_id": j["id"], "poll_after_ms": 2000}
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    def attempt(self, payload):
        self.auth("daily_training")
        practice_only = payload.get("practice_only", False)
        p, lesson, item = self.find_item(payload["plan_item_id"], writable=True, practice_only=practice_only)
        if (
            practice_only
            and sum(
                self.local_date(a["created_at"]) == self.local_date()
                for a in self.all("attempt")
                if a.get("practice_only")
            )
            >= self.settings.max_uploads_per_day
        ):
            fail(
                429,
                "rate_limit_exceeded",
                "Daily extra-practice limit reached.",
                {"retry_after_seconds": 3600},
            )
        practice_focus = self.practice_source(payload.get("based_on_attempt_id"), item["id"], practice_only)
        v = item["task"]["verification"]
        kind = v["type"]
        fields = {
            k for k in ("elapsed_seconds", "self_confirmed", "recording_id") if payload.get(k) is not None
        }
        required = {
            "timer": "elapsed_seconds",
            "self_confirmation": "self_confirmed",
            "recording": "recording_id",
        }[kind]
        if fields != {required}:
            fail(422, "validation_error", "Fields do not match the assigned verification type.")
        issues, metrics, coaching = [], None, []
        speech_feedback = {
            "scope": {
                "self_confirmation": "self_confirmed",
                "timer": "reported_time",
                "recording": "audio_quality_only",
            }[kind],
            "insights": [],
            "next_step": None,
        }
        if kind == "self_confirmation" and payload["self_confirmed"] is not True:
            issues = [{"code": "not_confirmed", "message": "Confirm completion after practicing."}]
        elif kind == "recording":
            rec = self.get(payload["recording_id"], "recording")
            canceled = any(
                c["result"].get("recording_id") == rec["id"] for c in self.all("upload_cancellation")
            )
            if (
                rec["purpose"] != "exercise"
                or rec["plan_item_id"] != item["id"]
                or rec.get("dismissed_at")
                or canceled
            ):
                fail(404, "not_found", "Recording not found for this plan item.")
            if bool(rec.get("practice_only")) != practice_only:
                fail(422, "practice_mode_mismatch", "Use a recording made for this practice mode.")
            if any(
                a.get("recording_id") == rec["id"] and a["status"] == "passed" for a in self.all("attempt")
            ):
                fail(
                    409,
                    "recording_already_used",
                    "This take is already saved. Record a new take for extra practice.",
                )
            if rec["status"] in ("queued", "processing"):
                fail(409, "recording_not_ready", "Wait for the recording check to finish.")
            if rec["status"] == "failed":
                fail(409, "recording_not_ready", "Retry the failed recording check first.")
            if rec.get("practice_focus"):
                if practice_focus and practice_focus["attempt_id"] != rec["practice_focus"]["attempt_id"]:
                    fail(422, "practice_focus_mismatch", "This take was made with a different saved focus.")
                practice_focus = rec["practice_focus"]
            issues = rec["quality"]["issues"]
            metrics = rec.get("measurements")
            speech_feedback = rec.get("speech_feedback") or speech_feedback
            target = v.get("target_wpm")
            if (target or v.get("required_metrics")) and not issues:
                rate = (metrics or {}).get("speaking_rate_wpm", {})
                if not rate.get("available"):
                    coaching = [
                        {
                            "code": "measurement_unavailable",
                            "message": "Timing could not be measured reliably. Your take is saved; use the listening prompt to reflect on it.",
                        }
                    ]
                elif target and not target["min"] <= rate["value"] <= target["max"]:
                    coaching = [
                        {
                            "code": "pace_outside_target",
                            "message": "For future practice, explore the suggested pace band without sacrificing clarity. This take counts.",
                        }
                    ]
        passed = not issues
        a = {
            "id": new_id(),
            "plan_item_id": item["id"],
            "practice_only": practice_only,
            "practice_focus": practice_focus,
            "training_focus": rec.get("training_focus") if kind == "recording" else None,
            "listening_plan": rec.get("listening_plan") if kind == "recording" else None,
            "reward": {"notes": 0, "parts": []},
            "practice_seconds": 0,
            "practice_seconds_source": {
                "recording": "audio_duration",
                "timer": "self_reported",
                "self_confirmation": "unknown",
            }[kind],
            "exercise_id": item["exercise_id"],
            "status": "passed" if passed else "needs_retry",
            "verification_type": kind,
            "elapsed_seconds": payload.get("elapsed_seconds"),
            "recording_id": payload.get("recording_id"),
            "feedback": {
                "summary": (
                    "Recording received. Audio quality checked; pronunciation and expression have not been scored."
                    if passed and kind == "recording"
                    else "Practice completed."
                    if passed
                    else "Please try this exercise again."
                ),
                **speech_feedback,
                "coaching": coaching,
                "metrics": metrics,
                "issues": issues,
            },
            "created_at": iso(),
            "completed_at": iso() if passed else None,
            "plan_item_status": "completed" if practice_only or passed else "pending",
        }
        if passed and not practice_only:
            parts = [{"notes": 2 if item["exercise_id"] == "E01" else 3, "reason": "exercise_completed"}]
            if kind == "recording":
                parts.append({"notes": 1, "reason": "quality_bonus"})
            a["reward"] = {"notes": sum(x["notes"] for x in parts), "parts": parts}
        if passed:
            a["practice_seconds"] = {
                "timer": lambda: payload["elapsed_seconds"],
                "recording": lambda: round(rec["duration_seconds"]),
                "self_confirmation": lambda: 0,
            }[kind]()
        if kind == "self_confirmation":
            a["self_confirmed"] = payload["self_confirmed"]
        if passed and kind == "recording":
            a["speech_review"] = self.start_speech_review(a)
        if not practice_only:
            item["latest_attempt_id"] = a["id"]
            if passed:
                item.update(status="completed", completed_at=a["completed_at"])
            lesson["status"] = "in_progress"
            self.put("plan", p)
        return 201, self.put("attempt", a)

    def today(self):
        p = self.plan(False)
        today = self.local_date().isoformat()
        lesson, status, next_date = None, "needs_assessment", None
        if p:
            done = next((x for x in p["lessons"] if x.get("completed_on") == today), None)
            if not done:
                done = next(
                    (
                        x
                        for plan in self.all("plan")
                        for x in plan["lessons"]
                        if x.get("completed_on") == today
                    ),
                    None,
                )
            if done:
                lesson, status = annotate_notes(done), "completed"
                if p["completed_lessons"] < 14:
                    next_date = (self.local_date() + timedelta(days=1)).isoformat()
            else:
                lesson = next((x for x in p["lessons"] if x["status"] in ("available", "in_progress")), None)
                status = lesson["status"] if lesson else "plan_completed"
                if lesson and status == "available":
                    status = "available"
        displayed_plan_id = p["id"] if p else None
        if lesson:
            displayed_plan_id = next(
                plan["id"]
                for plan in self.all("plan")
                if any(x["id"] == lesson["id"] for x in plan["lessons"])
            )
        return {
            "local_date": today,
            "timezone": self.guest.data["preferences"]["timezone"],
            "plan_id": displayed_plan_id,
            "lesson": lesson,
            "daily_status": status,
            "next_lesson_available_on": next_date,
            "streak": self.streak(),
            "reassessment": self.reassessment(),
        }

    def completion_view(self, p, lesson):
        later = next((x for x in p["lessons"] if x["day_index"] == lesson["day_index"] + 1), None)
        return {
            "lesson_id": lesson["id"],
            "plan_id": p["id"],
            "status": "completed",
            "completed_at": lesson["completed_at"],
            "completed_on": lesson["completed_on"],
            "timezone": lesson["timezone"],
            "completed_lessons": p["completed_lessons"],
            "total_lessons": 14,
            "streak": self.streak(),
            "session_reward": {
                "notes": (r := self.rewards({i["id"] for i in lesson["items"]}))["notes_total"],
                "practice_seconds": r["practice_seconds_total"],
            },
            "next_lesson_available_on": (
                date.fromisoformat(lesson["completed_on"]) + timedelta(days=1)
            ).isoformat()
            if later
            else None,
        }

    def complete(self, lesson_id):
        self.auth("daily_training")
        for p in self.all("plan"):
            lesson = next((x for x in p["lessons"] if x["id"] == str(lesson_id)), None)
            if not lesson:
                continue
            if lesson["status"] == "completed":
                return self.completion_view(p, lesson)
            if p["status"] != "active":
                fail(409, "plan_inactive", "This plan is no longer active.")
            pending = [i["id"] for i in lesson["items"] if i["status"] != "completed"]
            if pending:
                fail(
                    409,
                    "lesson_incomplete",
                    "Finish every exercise before completing the lesson.",
                    {"pending_plan_item_ids": pending},
                )
            if any(
                x.get("completed_on") == self.local_date().isoformat()
                for plan in self.all("plan")
                for x in plan["lessons"]
            ):
                fail(
                    409,
                    "daily_lesson_limit",
                    "Your next lesson opens tomorrow.",
                    {"next_lesson_available_on": (self.local_date() + timedelta(days=1)).isoformat()},
                )
            self.unlock(p)
            if lesson["status"] == "locked":
                fail(409, "lesson_locked", "This lesson is not available yet.")
            lesson.update(
                status="completed",
                completed_at=iso(),
                completed_on=self.local_date().isoformat(),
                timezone=self.guest.data["preferences"]["timezone"],
            )
            p["completed_lessons"] += 1
            if p["completed_lessons"] == 14:
                p["status"] = "completed"
            self.put("plan", p)
            return self.completion_view(p, lesson)
        fail(404, "not_found", "Lesson not found.")

    def paginate(self, values, limit, cursor=None):
        values = sorted(values, key=lambda v: (v["created_at"], v["id"]), reverse=True)
        if cursor:
            try:
                payload = self.signer.loads(cursor, max_age=86400)
                if payload["guest_id"] != self.guest.id:
                    raise ValueError()
                values = [v for v in values if [v["created_at"], v["id"]] < payload["position"]]
            except (BadSignature, ValueError, KeyError, TypeError):
                fail(422, "validation_error", "Invalid or expired cursor.")
        page = values[:limit]
        next_cursor = (
            self.signer.dumps(
                {"guest_id": self.guest.id, "position": [page[-1]["created_at"], page[-1]["id"]]}
            )
            if len(values) > limit
            else None
        )
        return page, next_cursor

    def progress(self, days, recordings_limit, cursor):
        p = self.plan(False)
        streak = self.streak()
        all_lessons = [
            lesson for plan in self.all("plan") for lesson in plan["lessons"] if lesson["completed_at"]
        ]
        activity = [
            {"date": (self.local_date() - timedelta(days=d)).isoformat(), "completed_lessons": 0}
            for d in reversed(range(days))
        ]
        for day in activity:
            day["completed_lessons"] = sum(lesson["completed_on"] == day["date"] for lesson in all_lessons)
        earliest = self.local_date() - timedelta(days=days - 1)
        history = [
            {"assessment_id": a["id"], "completed_at": a["completed_at"], "measurements": a["measurements"]}
            for a in self.assessments()
            if a["status"] == "completed" and self.local_date(a["completed_at"]) >= earliest
        ]
        recordings, next_cursor = self.paginate(self.all("recording"), recordings_limit, cursor)
        return {
            "timezone": self.guest.data["preferences"]["timezone"],
            "summary": {
                "completed_lessons_all_time": len(all_lessons),
                "current_plan_completed_lessons": p["completed_lessons"] if p else 0,
                "current_plan_total_lessons": 14 if p else 0,
                "current_streak_days": streak["current_days"],
                "longest_streak_days": streak["longest_days"],
                "last_practice_on": streak["last_practice_on"],
                **self.rewards(),
            },
            "activity": activity,
            "measurement_history": history,
            "recordings": recordings,
            "next_recordings_cursor": next_cursor,
            "reassessment": self.reassessment(),
        }
