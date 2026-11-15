import copy
import hashlib
import logging
import re
import shutil
from contextlib import asynccontextmanager
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException

from app.asr import feed, recognizer
from app.config import Settings
from app.content import CATALOG, EXERCISES
from app.db import Database, Guest, iso, new_id
from app.errors import ApiError, fail
from app.schemas import (
    AssessmentInput,
    AttemptInput,
    CancelUploadInput,
    CompleteInput,
    Empty,
    FocusCheckInput,
    GuestInput,
    PracticeFocusInput,
    Preferences,
    ReflectionInput,
)
from app.service import COOKIE, Service, digest

logger = logging.getLogger(__name__)


def create_app(settings=None):
    settings = settings or Settings()
    database = Database(settings.database_url)

    @asynccontextmanager
    async def lifespan(app):
        settings.audio_data.mkdir(parents=True, exist_ok=True)
        yield
        database.engine.dispose()

    app = FastAPI(title="Voice Training API", version="1.0.0", lifespan=lifespan)
    app.state.settings, app.state.database = settings, database
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Idempotency-Key", "Range"],
        expose_headers=["Retry-After", "Content-Range", "Accept-Ranges", "X-Request-ID"],
    )

    def error_response(request, status, code, message, details=None):
        headers = {"X-Request-ID": getattr(request.state, "request_id", new_id())}
        if status == 429:
            headers["Retry-After"] = str((details or {}).get("retry_after_seconds", 60))
        return JSONResponse(
            status_code=status,
            content={
                "error": {
                    "code": code,
                    "message": message,
                    "details": details or {},
                    "request_id": headers["X-Request-ID"],
                }
            },
            headers=headers,
        )

    @app.middleware("http")
    async def guard(request, call_next):
        request.state.request_id = new_id()
        origin = request.headers.get("origin")
        if (
            request.method in ("POST", "PUT", "PATCH", "DELETE")
            and origin
            and origin.rstrip("/") not in settings.origins
        ):
            return error_response(request, 403, "origin_not_allowed", "This browser origin is not allowed.")
        # Multipart parser spills to disk; enforce a streaming cap even without Content-Length.
        max_body = (
            settings.max_file_bytes + 128 * 1024 if request.url.path == "/api/v1/recordings" else 64 * 1024
        )
        try:
            if int(request.headers.get("content-length", "0")) > max_body:
                return error_response(request, 413, "file_too_large", "Request body exceeds the size limit.")
        except ValueError:
            return error_response(request, 400, "validation_error", "Invalid Content-Length.")
        receive, count = request._receive, 0

        async def limited_receive():
            nonlocal count
            msg = await receive()
            count += len(msg.get("body", b""))
            if count > max_body:
                # HTTPException is handled by the multipart/body parser and normalized below.
                raise HTTPException(413, "Request body exceeds the size limit.")
            return msg

        request._receive = limited_receive
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.exception_handler(ApiError)
    async def api_error(request, exc):
        return error_response(request, exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        details = {
            "fields": [
                {"path": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()
            ]
        }
        return error_response(request, 422, "validation_error", "Invalid request fields.", details)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error_response(
            request,
            exc.status_code,
            {404: "not_found", 413: "file_too_large", 416: "range_not_satisfiable"}.get(
                exc.status_code, "http_error"
            ),
            str(exc.detail),
        )

    @app.exception_handler(IntegrityError)
    async def conflict(request, exc):
        logger.warning("Database conflict request_id=%s", request.state.request_id)
        return error_response(
            request, 409, "concurrent_update", "Please retry the request with the same idempotency key."
        )

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        # Never log request bodies, audio, or provider responses containing user content.
        logger.error(
            "Unhandled exception type=%s request_id=%s", type(exc).__name__, request.state.request_id
        )
        return error_response(request, 500, "internal_error", "An unexpected error occurred.")

    def service(request: Request):
        with database.session() as db:
            if settings.database_url.startswith("sqlite") and request.method in (
                "POST",
                "PATCH",
                "PUT",
                "DELETE",
            ):
                db.execute(text("BEGIN IMMEDIATE"))
            s = Service(
                db, settings, request.cookies.get(COOKIE), write=request.method not in ("GET", "HEAD")
            )
            s.rollback_files = []
            try:
                yield s
                db.commit()
            except BaseException:
                db.rollback()
                for path in s.rollback_files:
                    path.unlink(missing_ok=True)
                raise

    S = Annotated[Service, Depends(service, scope="function")]

    def key(request):
        try:
            return str(UUID(request.headers.get("Idempotency-Key", "")))
        except ValueError:
            fail(422, "validation_error", "Idempotency-Key must be a UUID.")

    def mutate(s, request, payload, fn):
        status, result = s.mutate(key(request), request.method, request.url.path, payload, fn)
        return JSONResponse(
            status_code=status, content=result, headers={"Retry-After": "2"} if status == 202 else None
        )

    @app.get("/health/live")
    def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready():
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        try:
            with database.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
                version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
                expected = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
                if version != expected:
                    raise RuntimeError("migrations_pending")
        except (SQLAlchemyError, RuntimeError):
            fail(
                503,
                "service_not_ready",
                "The API is not ready.",
                {"database": "unavailable_or_migrations_pending"},
            )
        return {"status": "ready", "checks": {"database": "ok", "migrations": "ok"}}

    @app.post("/api/v1/guest-session")
    def guest_session(payload: GuestInput, request: Request, s: S):
        k = key(request)
        if not s.guest:
            creation_key = digest(k)
            if database.engine.dialect.name == "postgresql":
                # Serialize anonymous retries before any guest row exists.
                lock_id = int(creation_key[:15], 16)
                s.db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": lock_id})
            existing = s.db.scalar(select(Guest).where(Guest.creation_key == creation_key).with_for_update())
            if existing:
                s.guest = existing
        if s.guest:
            s.guest.data = copy.deepcopy(s.guest.data)
            # Replay creation with the original key, but a new key simply resumes the cookie session.
            if s.guest.creation_key == digest(k):

                def resume_created():
                    return 201, s.guest_view()

                response = mutate(s, request, payload.model_dump(), resume_created)
            else:
                response = JSONResponse(s.guest_view(), status_code=200)
        else:
            if not payload.consent.audio_processing:
                fail(422, "consent_required", "Audio processing consent is required.")
            s.guest = Guest(
                id=new_id(),
                creation_key=digest(k),
                data={
                    "created_at": iso(),
                    "preferences": payload.model_dump(exclude={"consent"}),
                    "consent": {**payload.consent.model_dump(), "accepted_at": iso()},
                },
            )
            s.db.add(s.guest)
            s.db.flush()
            response = mutate(s, request, payload.model_dump(), lambda: (201, s.guest_view()))
        response.set_cookie(
            COOKIE,
            s.signer.dumps(s.guest.id),
            httponly=True,
            secure=settings.cookie_secure or request.url.scheme == "https",
            samesite="lax",
            max_age=31536000,
            path="/",
        )
        return response

    @app.get("/api/v1/me")
    def me(s: S):
        return s.me()

    @app.post("/api/v1/demo/seed")
    def demo_seed(s: S):
        if not settings.demo_mode:
            fail(403, "demo_mode_disabled", "Demo mode is not enabled.")
        from app.demo import seed

        return seed(s)

    @app.patch("/api/v1/preferences")
    def preferences(payload: Preferences, s: S):
        s.auth()
        values = payload.model_dump(exclude_unset=True)
        if not values or any(v is None for v in values.values()):
            fail(422, "validation_error", "Provide at least one non-null preference.")
        s.guest.data["preferences"].update(values)
        return s.guest.data["preferences"]

    @app.post("/api/v1/assessments")
    def create_assessment(payload: AssessmentInput, request: Request, s: S):
        values = payload.model_dump()
        return mutate(s, request, values, lambda: s.create_assessment(values))

    @app.get("/api/v1/assessments")
    def assessments(s: S, limit: int = Query(20, ge=1, le=100), cursor: str | None = None):
        page, next_cursor = s.paginate(s.assessments(), limit, cursor)
        return {
            "items": [
                {k: a.get(k) for k in ("id", "kind", "status", "created_at", "completed_at", "plan_id")}
                for a in page
            ],
            "next_cursor": next_cursor,
        }

    @app.get("/api/v1/assessments/{assessment_id}")
    def assessment(assessment_id: UUID, s: S):
        return s.assessment_state(assessment_id)

    @app.post("/api/v1/assessments/{assessment_id}/submit")
    def submit(assessment_id: UUID, payload: Empty, request: Request, s: S):
        s.auth("assessment")
        return mutate(s, request, {}, lambda: s.submit(assessment_id))

    @app.post("/api/v1/recordings")
    def upload(
        request: Request,
        s: S,
        file: Annotated[UploadFile, File()],
        purpose: Annotated[Literal["assessment", "exercise"], Form()],
        assessment_id: Annotated[UUID | None, Form()] = None,
        task_id: Annotated[UUID | None, Form()] = None,
        plan_item_id: Annotated[UUID | None, Form()] = None,
        practice_only: Annotated[bool, Form()] = False,
        based_on_attempt_id: Annotated[UUID | None, Form()] = None,
        training_focus_id: Annotated[UUID | None, Form()] = None,
    ):
        s.auth()
        fields = {
            "purpose": purpose,
            "assessment_id": str(assessment_id) if assessment_id else None,
            "task_id": str(task_id) if task_id else None,
            "plan_item_id": str(plan_item_id) if plan_item_id else None,
        }
        if practice_only:
            fields["practice_only"] = True
        if based_on_attempt_id:
            fields["based_on_attempt_id"] = str(based_on_attempt_id)
        if training_focus_id:
            fields["training_focus_id"] = str(training_focus_id)
        fingerprint, size = hashlib.sha256(), 0
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > settings.max_file_bytes:
                fail(
                    413,
                    "file_too_large",
                    "Maximum upload size is 25 MiB.",
                    {"max_file_bytes": settings.max_file_bytes},
                )
            fingerprint.update(chunk)
        if not size:
            fail(415, "unsupported_audio_format", "Audio file is empty.")
        file.file.seek(0)
        signature = file.file.read(16)
        if signature.startswith(b"RIFF") and signature[8:12] == b"WAVE":
            mime_type = "audio/wav"
        elif signature.startswith(b"\x1aE\xdf\xa3"):
            mime_type = "audio/webm"
        elif signature.startswith(b"OggS"):
            mime_type = "audio/ogg"
        elif signature[4:8] == b"ftyp":
            mime_type = "audio/mp4"
        elif signature.startswith(b"ID3") or (
            len(signature) >= 2 and signature[0] == 255 and signature[1] & 224 == 224
        ):
            mime_type = "audio/mpeg"
        else:
            fail(415, "unsupported_audio_format", "This audio container is not supported.")
        return mutate(
            s,
            request,
            {**fields, "sha256": fingerprint.hexdigest(), "mime_type": mime_type},
            lambda: s.upload(file, fields, mime_type, upload_key=key(request)),
        )

    @app.put("/api/v1/recording-uploads/{upload_key}/cancellation")
    def cancel_upload(upload_key: UUID, payload: CancelUploadInput, s: S):
        return s.cancel_upload(str(upload_key), payload.plan_item_id)

    @app.get("/api/v1/jobs/{job_id}")
    def job(job_id: UUID, s: S):
        return s.job(job_id).data

    @app.post("/api/v1/jobs/{job_id}/retry")
    def retry_job(job_id: UUID, payload: Empty, request: Request, s: S):
        return mutate(s, request, {}, lambda: s.retry_job(job_id))

    @app.get("/api/v1/recordings/{recording_id}")
    def recording(recording_id: UUID, s: S):
        return s.get(recording_id, "recording")

    @app.put("/api/v1/recordings/{recording_id}/dismiss")
    def dismiss_recording(recording_id: UUID, payload: Empty, s: S):
        return s.dismiss_recording(recording_id)

    @app.get("/api/v1/recordings/{recording_id}/audio")
    def audio(recording_id: UUID, request: Request, s: S):
        rec = s.get(recording_id, "recording")
        path = settings.audio_data / s.guest.id / rec["id"]
        if not path.is_file():
            fail(404, "not_found", "Recording not found.")
        byte_range = request.headers.get("range")
        if byte_range:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", byte_range)
            size = path.stat().st_size
            valid = bool(match and (match[1] or match[2]))
            if valid:
                start, end = match.groups()
                valid = (not start and int(end) > 0) or (
                    bool(start) and int(start) < size and (not end or int(end) >= int(start))
                )
            if not valid:
                fail(
                    416,
                    "range_not_satisfiable",
                    "The requested audio range is not available.",
                    {"size_bytes": size},
                )
        # Starlette streams valid single ranges and suffix ranges.
        return FileResponse(
            path,
            media_type=rec["mime_type"],
            filename="recording",
            content_disposition_type="inline",
            headers={"Cache-Control": "private, no-store"},
        )

    @app.websocket("/api/v1/speech-follow")
    async def speech_follow(ws: WebSocket, rate: int = 16000):
        """Live transcript of the take being recorded, used only to highlight read words.

        In: binary frames of float32 mono samples at `rate`.
        Out after each frame: {"words": [[word, start_seconds], ...]} heard so far in this stream.
        Audio is decoded in memory and never stored.
        """
        # Cookie-authenticated WebSockets bypass CORS: check Origin like the HTTP guard does.
        origin = ws.headers.get("origin")
        if origin and origin.rstrip("/") not in settings.origins:
            return await ws.close(1008)
        with database.session() as db:
            guest = Service(db, settings, ws.cookies.get(COOKIE)).guest
        rec = recognizer(settings.asr_model_dir)
        if not guest or not rec or not 8000 <= rate <= 48000:
            return await ws.close(1008 if rec else 1011)
        await ws.accept()
        stream, left = rec.create_stream(), rate * settings.max_recording_seconds
        try:
            while left > 0:
                chunk = await ws.receive_bytes()
                if len(chunk) % 4 or len(chunk) > rate * 4:  # whole samples, at most 1 s per frame
                    return await ws.close(1003)
                left -= len(chunk) // 4
                await ws.send_json({"words": await run_in_threadpool(feed, rec, stream, rate, chunk)})
            await ws.close(1000)  # recording limit reached
        except WebSocketDisconnect:
            pass

    @app.get("/api/v1/exercises")
    def exercises(s: S):
        s.auth()
        return CATALOG

    @app.get("/api/v1/exercises/{exercise_id}")
    def exercise(exercise_id: str, s: S):
        s.auth()
        if exercise_id not in EXERCISES:
            fail(404, "not_found", "Exercise not found.")
        return EXERCISES[exercise_id]

    @app.get("/api/v1/plan")
    def plan(s: S):
        return s.plan()

    @app.get("/api/v1/plans/{plan_id}")
    def plan_by_id(plan_id: UUID, s: S):
        return s.unlock(s.get(plan_id, "plan"))

    @app.get("/api/v1/today")
    def today(s: S):
        return s.today()

    @app.get("/api/v1/plan-items/{item_id}")
    def plan_item(item_id: UUID, s: S):
        return s.item_state(item_id)

    @app.post("/api/v1/exercise-attempts")
    def attempt(payload: AttemptInput, request: Request, s: S):
        values = payload.model_dump(mode="json")
        if values["based_on_attempt_id"] is None:
            values.pop("based_on_attempt_id")
        if not values["practice_only"]:
            values.pop("practice_only")  # Preserve legacy request fingerprints for retries across deploys.
        return mutate(s, request, values, lambda: s.attempt(values))

    @app.get("/api/v1/exercise-attempts")
    def attempt_history(
        plan_item_id: UUID,
        s: S,
        limit: int = Query(20, ge=1, le=100),
        cursor: str | None = None,
    ):
        s.find_item(plan_item_id)
        page, next_cursor = s.paginate(
            [a for a in s.all("attempt") if a["plan_item_id"] == str(plan_item_id)],
            limit,
            cursor,
        )
        return {"items": page, "next_cursor": next_cursor}

    @app.put("/api/v1/exercise-attempts/{attempt_id}/reflection")
    def reflection(attempt_id: UUID, payload: ReflectionInput, s: S):
        attempt = s.get(attempt_id, "attempt")
        note = payload.note.strip()
        if attempt.get("reflection", {}).get("note") != note:
            attempt["reflection"] = {"note": note, "updated_at": iso()}
            s.put("attempt", attempt)
        return attempt

    @app.get("/api/v1/practice-focus")
    def practice_focus(s: S):
        return s.practice_focus_view()

    @app.post("/api/v1/practice-focus")
    def save_practice_focus(payload: PracticeFocusInput, request: Request, s: S):
        values = payload.model_dump(mode="json")
        return mutate(s, request, values, lambda: s.save_practice_focus(values))

    @app.delete("/api/v1/practice-focus/{focus_id}", status_code=204)
    def clear_practice_focus(focus_id: UUID, s: S):
        s.clear_practice_focus(focus_id)
        return Response(status_code=204)

    @app.put("/api/v1/exercise-attempts/{attempt_id}/focus-check")
    def focus_check(attempt_id: UUID, payload: FocusCheckInput, s: S):
        return s.save_focus_check(attempt_id, payload.outcome)

    @app.post("/api/v1/exercise-attempts/{attempt_id}/review")
    def speech_review(attempt_id: UUID, payload: Empty, request: Request, s: S):
        return mutate(s, request, {}, lambda: s.request_speech_review(attempt_id))

    @app.get("/api/v1/exercise-attempts/{attempt_id}")
    def attempt_by_id(attempt_id: UUID, s: S):
        return s.get(attempt_id, "attempt")

    @app.put("/api/v1/progress/{lesson_id}")
    def complete(lesson_id: UUID, payload: CompleteInput, s: S):
        return s.complete(lesson_id)

    @app.get("/api/v1/progress")
    def progress(
        s: S,
        days: int = Query(30, ge=1, le=365),
        recordings_limit: int = Query(20, ge=1, le=100),
        recordings_cursor: str | None = None,
    ):
        return s.progress(days, recordings_limit, recordings_cursor)

    @app.delete("/api/v1/guest-data", status_code=204)
    def delete_guest(request: Request, s: S):
        s.auth()
        directory = settings.audio_data / s.guest.id
        # Guest row lock serializes uploads and worker publication with deletion.
        if directory.exists():
            shutil.rmtree(directory)
        s.db.delete(s.guest)
        s.db.flush()
        response = Response(status_code=204)
        response.delete_cookie(
            COOKIE,
            path="/",
            httponly=True,
            secure=settings.cookie_secure or request.url.scheme == "https",
            samesite="lax",
        )
        return response

    return app


app = create_app()
