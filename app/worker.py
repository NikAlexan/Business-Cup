import copy
import logging
import signal
import threading
import time

import numpy as np
from sqlalchemy import and_, case, or_, select, update

from app.audio import (
    QUALITY_RULES,
    AudioRejected,
    combine_timing,
    decode,
    pitch,
    quality_check,
    timing_metrics,
)
from app.coaching import quote_evidence, timing_feedback
from app.config import Settings
from app.content import EXERCISES, TARGETS_VERSION, generate_plan, interpret
from app.db import Database, Guest, Job, iso, new_id
from app.provider import OpenAIAudioProvider, ProviderFailure
from app.service import Service

log = logging.getLogger("voice.worker")


MEASUREMENT_VERSION = "voice-metrics-v3"


class WorkCancelled(Exception):
    pass


def assessments_comparable(before, after):
    return bool(
        before
        and not before.get("analysis_metadata", {}).get("demo", {}).get("prepared_data", False)
        and not after.get("analysis_metadata", {}).get("demo", {}).get("prepared_data", False)
        and before.get("protocol_version")
        and before.get("recording_conditions") is not None
        and before.get("recording_conditions") == after.get("recording_conditions")
        and before.get("protocol_version") == after.get("protocol_version")
        and before.get("analysis_metadata", {}).get("measurement_version") == MEASUREMENT_VERSION
    )


def comparable_measurements(previous, current):
    """Interpretation and comparison share the same conditions/version gate."""
    return previous["measurements"] if assessments_comparable(previous, current) else None


def compare(before, after, measurements):
    compatible = assessments_comparable(before, after)
    metrics = {}
    for name, value in measurements.items():
        if name in ("f0_timeline", "f0_range_hz"):
            continue
        previous = before["measurements"].get(name, {})
        available = compatible and previous.get("available", False) and value["available"]
        metrics[name] = {
            "available": available,
            "before": previous.get("value"),
            "after": value["value"],
            "delta": round(value["value"] - previous["value"], 3) if available else None,
            "unit": value["unit"],
            "interpretation": "descriptive_only" if available else "not_comparable",
        }
        if not available:
            metrics[name]["unavailable_reason"] = "recording_conditions_or_measurement_quality"
    return {
        "baseline_assessment_id": before["id"],
        "current_assessment_id": after["id"],
        "comparable": compatible,
        "metrics": metrics,
        "limitations": ["These are descriptive measurements, not proof of improvement."]
        + ([] if compatible else ["Recording conditions or analysis versions differ."]),
        "summary": "Compare your own recordings. Numerical differences alone do not establish improvement."
        if compatible
        else "The recording conditions do not support a reliable numerical comparison.",
        "audio_pairs": [
            {
                "kind": t["kind"],
                "before_audio_url": f"/api/v1/recordings/{next(b['recording_id'] for b in before['tasks'] if b['kind'] == t['kind'])}/audio",
                "after_audio_url": f"/api/v1/recordings/{t['recording_id']}/audio",
            }
            for t in after["tasks"]
            if t.get("recording_id")
            and any(b["kind"] == t["kind"] and b.get("recording_id") for b in before["tasks"])
        ],
    }


class Worker:
    def __init__(self, settings=None, database=None, provider_factory=OpenAIAudioProvider):
        self.settings = settings or Settings()
        self.database = database or Database(self.settings.database_url)
        self.provider_factory = provider_factory

    def claim(self):
        now = time.time()
        with self.database.session.begin() as db:
            row = db.scalar(
                select(Job)
                .where(
                    or_(
                        and_(Job.status == "queued", or_(Job.lease_until.is_(None), Job.lease_until <= now)),
                        and_(Job.status == "processing", Job.lease_until <= now),
                    )
                )
                .order_by(
                    case((Job.data["type"].as_string() == "recording_check", 0), else_=1),
                    Job.data["created_at"].as_string(),
                    Job.id,
                )
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if not row:
                return None
            d = copy.deepcopy(row.data)
            exhausted = d["attempt_count"] >= d["max_attempts"]
            d.update(
                status="processing",
                stage="decoding",
                attempt_count=d["attempt_count"] + (0 if exhausted else 1),
                updated_at=iso(),
            )
            row.status, row.data = "processing", d
            row.lease_token, row.lease_until = new_id(), now + self.settings.job_lease_seconds
            return {
                "job": copy.deepcopy(d),
                "guest_id": row.guest_id,
                "lease_token": row.lease_token,
                "exhausted": exhausted,
            }

    def locked(self, db, claim):
        guest = db.scalar(select(Guest).where(Guest.id == claim["guest_id"]).with_for_update())
        if not guest:
            raise WorkCancelled()
        job = db.scalar(select(Job).where(Job.id == claim["job"]["id"]).with_for_update())
        if not job or job.status != "processing" or job.lease_token != claim["lease_token"]:
            raise WorkCancelled()
        service = Service(db, self.settings)
        service.guest = guest
        return service, job

    def stage(self, claim, stage):
        with self.database.session.begin() as db:
            s, j = self.locked(db, claim)
            d = copy.deepcopy(j.data)
            d.update(stage=stage, updated_at=iso())
            j.data, j.lease_until = d, time.time() + self.settings.job_lease_seconds
            if d["type"] == "exercise_review":
                a = s.get(d["attempt_id"], "attempt")
                a["speech_review"]["status"] = "processing"
                s.put("attempt", a)
            if d["assessment_id"] and d["type"] == "assessment_analysis":
                a = s.get(d["assessment_id"], "assessment")
                a["status"] = "processing"
                s.put("assessment", a)
            if d["recording_id"]:
                r = s.get(d["recording_id"], "recording")
                r["status"] = "processing"
                s.put("recording", r)

    def heartbeat(self, claim, stop):
        while not stop.wait(self.settings.job_lease_seconds / 3):
            try:
                with self.database.session.begin() as db:
                    db.execute(
                        update(Job)
                        .where(
                            Job.id == claim["job"]["id"],
                            Job.status == "processing",
                            Job.lease_token == claim["lease_token"],
                        )
                        .values(lease_until=time.time() + self.settings.job_lease_seconds)
                    )
            except Exception:
                log.warning("Heartbeat failed job_id=%s", claim["job"]["id"])

    def snapshot(self, claim, rid, kind):
        with self.database.session.begin() as db:
            s, _ = self.locked(db, claim)
            return s.get(rid, kind)

    def publish_recording(self, claim, rec, quality, measurements=None, speech_feedback=None):
        with self.database.session.begin() as db:
            s, job = self.locked(db, claim)
            rec = s.get(rec["id"], "recording")  # Preserve a dismissal made while processing.
            rec.update(
                status="completed" if quality["status"] == "accepted" else "needs_rerecord",
                duration_seconds=quality["duration_seconds"],
                quality=quality,
            )
            if measurements is not None:
                rec["measurements"] = measurements
            if speech_feedback is not None:
                rec["speech_feedback"] = speech_feedback
            s.put("recording", rec)
            if rec["assessment_id"]:
                a = s.get(rec["assessment_id"], "assessment")
                task = next(t for t in a["tasks"] if t["id"] == rec["task_id"])
                if task.get("pending_recording_id") == rec["id"]:
                    task.pop("pending_recording_id", None)
                    if quality["status"] == "accepted" or task["recording_id"] is None:
                        task.update(recording_id=rec["id"], quality_status=quality["status"])
                    if any(t.get("quality_status") == "rejected" for t in a["tasks"]):
                        a["status"] = "needs_rerecord"
                    else:
                        a["status"] = "draft"
                    s.put("assessment", a)
            d = copy.deepcopy(job.data)
            d.update(
                status=rec["status"],
                stage="done",
                poll_after_ms=None,
                updated_at=iso(),
                result={"recording_id": rec["id"], "quality": quality, "measurements": measurements},
            )
            job.status, job.data, job.lease_until = d["status"], d, None

    def recording(self, claim):
        rec = self.snapshot(claim, claim["job"]["recording_id"], "recording")
        if rec["purpose"] == "assessment":
            a = self.snapshot(claim, rec["assessment_id"], "assessment")
            max_seconds = next(t["max_duration_seconds"] for t in a["tasks"] if t["id"] == rec["task_id"])
        else:
            with self.database.session.begin() as db:
                s, _ = self.locked(db, claim)
                _, _, item = s.find_item(rec["plan_item_id"])
                max_seconds = min(
                    self.settings.max_recording_seconds, item["task"]["verification"]["max_recording_seconds"]
                )
        path = self.settings.audio_data / claim["guest_id"] / rec["id"]
        speech_feedback = None
        try:
            signal = decode(path, self.settings, max_seconds)
            self.stage(claim, "quality_check")
            quality, segments = quality_check(
                signal,
                self.settings,
                rec["purpose"],
                item["task"]["verification"].get("quality_rules") if rec["purpose"] == "exercise" else None,
            )
            measurements = timing_metrics(signal, segments) if rec["purpose"] == "exercise" else None
            if rec["purpose"] == "exercise" and quality["status"] == "accepted":
                required = item["task"]["verification"].get("required_metrics")
                if required is None:  # Legacy snapshots predate required-metric persistence.
                    required = (
                        EXERCISES.get(item["exercise_id"], {})
                        .get("verification", {})
                        .get("required_metrics", [])
                    )
                if set(required) & {"speaking_rate_wpm", "pause_ratio", "pause_count"}:
                    self.stage(claim, "transcription")
                    provider = None
                    try:
                        provider = self.provider_factory(self.settings)
                        transcript = provider.transcribe(
                            signal, " ".join([item["task"]["text"]] * item["task"].get("repetitions", 1))
                        )
                        measurements = timing_metrics(
                            signal, segments, transcript["word_count"], transcript["words"]
                        )
                        speech_feedback = timing_feedback(
                            transcript,
                            measurements,
                            item["task"]["verification"],
                            quality["duration_seconds"],
                        )
                        with self.database.session.begin() as db:
                            s, _ = self.locked(db, claim)
                            s.put(
                                "ai_usage",
                                {
                                    "id": new_id(),
                                    "created_at": iso(),
                                    "recording_id": rec["id"],
                                    "calls": copy.deepcopy(provider.usage),
                                },
                            )
                    except ProviderFailure:
                        # An optional coaching metric must not invalidate a usable daily take.
                        for value in measurements.values():
                            value["unavailable_reason"] = "transcription_provider_unavailable"
                    finally:
                        if provider is not None:
                            provider.close()
        except AudioRejected as exc:
            quality = {
                "status": "rejected",
                "duration_seconds": None,
                "speech_seconds": None,
                "clipping_ratio": None,
                "noise_level": "unavailable",
                "issues": [{"code": exc.code, "message": exc.message}],
            }
            measurements = None
        self.publish_recording(claim, rec, quality, measurements, speech_feedback)

    def exercise_review(self, claim):
        attempt = self.snapshot(claim, claim["job"]["attempt_id"], "attempt")
        rec = self.snapshot(claim, attempt["recording_id"], "recording")
        with self.database.session.begin() as db:
            s, _ = self.locked(db, claim)
            _, _, item = s.find_item(attempt["plan_item_id"])
        path = self.settings.audio_data / claim["guest_id"] / rec["id"]
        signal = decode(path, self.settings, item["task"]["verification"]["max_recording_seconds"])
        self.stage(claim, "transcription")
        provider = self.provider_factory(self.settings)
        try:
            transcript = provider.transcribe(
                signal, " ".join([item["task"]["text"]] * item["task"].get("repetitions", 1))
            )
            metrics = timing_metrics(signal, [], transcript["word_count"], transcript["words"])
            report = None
            if not metrics["speaking_rate_wpm"]["available"]:
                status, reason = "unavailable", "transcription_unverified"
            else:
                self.stage(claim, "speech_coaching")
                report = provider.exercise_review(
                    signal,
                    {
                        "goal": attempt["speech_review"]["goal"],
                        "title": item["title"],
                        "task": item["task"],
                        "saved_focus": (attempt.get("practice_focus") or {}).get("note", ""),
                        "verified_transcript": transcript["text"],
                        "measurements": metrics,
                    },
                )
                observation = report.get("observation")
                if observation:
                    evidence = quote_evidence(
                        observation["evidence_quote"],
                        transcript,
                        len(signal) / 16000,
                        observation.get("occurrence", 1),
                    )
                    if not evidence:
                        raise ProviderFailure("analysis_invalid_evidence")
                    observation["evidence"] = evidence
                status, reason = "completed", None
            usage = copy.deepcopy(provider.usage)
        finally:
            provider.close()
        with self.database.session.begin() as db:
            s, job = self.locked(db, claim)
            # Re-read to preserve reflections saved while the analysis was in flight.
            a = s.get(attempt["id"], "attempt")
            a["speech_review"].update(
                status=status,
                report=report,
                reason=reason,
                completed_at=iso(),
                source="audio_model",
                model=self.settings.audio_model,
                error=None,
            )
            s.put("attempt", a)
            s.put("ai_usage", {"id": new_id(), "attempt_id": a["id"], "created_at": iso(), "calls": usage})
            d = copy.deepcopy(job.data)
            d.update(
                status="completed",
                stage="done",
                updated_at=iso(),
                poll_after_ms=None,
                result={"attempt_id": a["id"], "review_status": status},
            )
            job.status, job.data, job.lease_until = "completed", d, None

    def assessment(self, claim):
        a = self.snapshot(claim, claim["job"]["assessment_id"], "assessment")
        signals, recordings = [], []
        for task in a["tasks"]:
            rec = self.snapshot(claim, task["recording_id"], "recording")
            signals.append(
                decode(self.settings.audio_data / claim["guest_id"] / rec["id"], self.settings, 60)
            )
            recordings.append(rec)
        self.stage(claim, "measurements")
        reading = np.concatenate(
            signals[:2]
        )  # tasks 1 + 2 are the reading passages; task 3 is for the AI only
        pitch_metrics, intonation = pitch(reading)
        # Configuration errors are explicit, never a synthetic report.
        provider = self.provider_factory(self.settings)
        try:
            self.stage(claim, "transcription")
            transcripts = [provider.transcribe(signals[i], a["tasks"][i]["text"]) for i in (0, 1)]
            measurements = {
                **pitch_metrics,
                **combine_timing(
                    *(
                        (t["word_count"], t["words"], len(signals[i]) / 16000)
                        for i, t in enumerate(transcripts)
                    )
                ),
                "intonation_range_semitones": intonation,
            }
            previous = (
                self.snapshot(claim, a["previous_assessment_id"], "assessment")
                if a["previous_assessment_id"]
                else None
            )
            comparison = compare(previous, a, measurements) if previous else None
            interpretation = interpret(a["goal"], measurements, comparable_measurements(previous, a))
            self.stage(claim, "ai_analysis")
            report = provider.report(signals, a, measurements, comparison, interpretation)
            transcript = {"verified": all(t["verified"] for t in transcripts)}
            if not transcript["verified"] or not measurements["speaking_rate_wpm"]["available"]:
                report["limitations"].append(
                    "Pace and pauses could not be measured reliably from transcript timing."
                )
            usage = copy.deepcopy(provider.usage)
        finally:
            provider.close()
        self.stage(claim, "plan_generation")
        with self.database.session.begin() as db:
            s, job = self.locked(db, claim)
            old_plans = s.all("plan")
            p = generate_plan(a, report, max((p["version"] for p in old_plans), default=0) + 1, old_plans)
            for old in old_plans:
                if old["status"] != "archived":
                    old["status"] = "archived"
                    s.put("plan", old)
            s.put("plan", p)
            a.update(
                status="completed",
                completed_at=iso(),
                recordings=recordings,
                measurements=measurements,
                measurement_scope={
                    "pace_and_pauses_task_ids": [t["id"] for t in a["tasks"][:2]],
                    "pitch_task_ids": [t["id"] for t in a["tasks"][:2]],
                    "intonation_task_ids": [t["id"] for t in a["tasks"][:2]],
                },
                report=report,
                interpretation=interpretation,
                comparison=comparison,
                plan_id=p["id"],
                analysis_metadata={
                    "protocol_version": a["protocol_version"],
                    "measurement_version": MEASUREMENT_VERSION,
                    "targets_version": TARGETS_VERSION,
                    "quality_rules_version": "quality-v1",
                    "thresholds": QUALITY_RULES,
                    "transcription_status": "completed" if transcript["verified"] else "unverified",
                    "demo": {
                        "enabled": self.settings.demo_mode,
                        "date_override_used": a["demo_override_used"],
                        "prepared_data": False,
                    },
                },
            )
            s.put("assessment", a)
            a["next_reassessment"] = s.reassessment()
            s.put("assessment", a)
            s.put("ai_usage", {"id": new_id(), "assessment_id": a["id"], "created_at": iso(), "calls": usage})
            d = copy.deepcopy(job.data)
            d.update(
                status="completed",
                stage="done",
                updated_at=iso(),
                poll_after_ms=None,
                result={"assessment_id": a["id"], "plan_id": p["id"]},
            )
            job.status, job.data, job.lease_until = "completed", d, None

    def failure(self, claim, exc):
        code = (
            exc.code
            if isinstance(exc, ProviderFailure)
            else (
                str(exc)
                if str(exc) in ("vad_not_configured", "ffmpeg_not_configured")
                else "analysis_processing_failed"
            )
        )
        retryable = (
            exc.retryable
            if isinstance(exc, ProviderFailure)
            else code not in ("vad_not_configured", "ffmpeg_not_configured")
        )
        with self.database.session.begin() as db:
            s, job = self.locked(db, claim)
            d = copy.deepcopy(job.data)
            again = retryable and d["attempt_count"] < d["max_attempts"]
            d.update(
                status="queued" if again else "failed",
                updated_at=iso(),
                poll_after_ms=2000 if again else None,
                retryable=retryable and not again,
                error=None
                if again
                else {
                    "code": code,
                    "message": "Voice analysis could not finish. Check service configuration."
                    if not retryable
                    else "Voice analysis is temporarily unavailable.",
                },
            )
            job.status, job.data = d["status"], d
            job.lease_until = time.time() + min(2 ** d["attempt_count"], 30) if again else None
            job.lease_token = None
            if d["type"] == "assessment_analysis":
                a = s.get(d["assessment_id"], "assessment")
                a["status"] = d["status"]
                s.put("assessment", a)
            elif d["type"] == "exercise_review":
                a = s.get(d["attempt_id"], "attempt")
                a["speech_review"].update(status=d["status"], error=d["error"])
                s.put("attempt", a)
            elif d["recording_id"]:
                rec = s.get(d["recording_id"], "recording")
                rec["status"] = d["status"]
                s.put("recording", rec)
                if not again and rec["assessment_id"]:
                    a = s.get(rec["assessment_id"], "assessment")
                    task = next(t for t in a["tasks"] if t["id"] == rec["task_id"])
                    if task.get("pending_recording_id") == rec["id"]:
                        task.pop("pending_recording_id", None)
                    s.put("assessment", a)

    def run_once(self):
        claim = self.claim()
        if not claim:
            return False
        if claim.get("exhausted"):
            try:
                self.failure(claim, ProviderFailure("worker_retry_exhausted", True))
            except WorkCancelled:
                pass
            return True
        stop = threading.Event()
        thread = threading.Thread(target=self.heartbeat, args=(claim, stop), daemon=True)
        thread.start()
        try:
            self.stage(claim, "decoding")
            {
                "recording_check": self.recording,
                "assessment_analysis": self.assessment,
                "exercise_review": self.exercise_review,
            }[claim["job"]["type"]](claim)
        except WorkCancelled:
            log.info("Discarded canceled/stale result job_id=%s", claim["job"]["id"])
        except Exception as exc:
            log.warning("Job error job_id=%s type=%s", claim["job"]["id"], type(exc).__name__)
            try:
                self.failure(claim, exc)
            except WorkCancelled:
                pass
        finally:
            stop.set()
            thread.join(timeout=2)
        return True


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    worker = Worker()
    stopped = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    while not stopped.is_set():
        if not worker.run_once():
            stopped.wait(worker.settings.worker_poll_seconds)


if __name__ == "__main__":
    main()
