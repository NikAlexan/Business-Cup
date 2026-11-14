"""Local-only browser test server: temporary database/audio, demo seed and no paid credentials."""

import os
import subprocess
import tempfile
import threading
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from fastapi.responses import FileResponse

from app.config import Settings

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "frontend" / "dist"
FIXTURES = ROOT / "frontend" / ".browser-fixtures"
SECRET = "isolated-browser-tests-only-not-a-production-secret"


def main():
    os.chdir(ROOT)
    if not (DIST / "index.html").is_file():
        raise RuntimeError("Build the frontend before browser tests")
    FIXTURES.mkdir(exist_ok=True)
    speech = FIXTURES / "speech.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "flite=text='Today we walk beside the river and watch the morning light. A small boat moves across the water. We stop beside the old bridge and listen to the birds. There is time to notice the details before we continue along the path.':voice=slt",
            "-ar",
            "48000",
            str(speech),
        ],
        check=True,
    )
    with tempfile.TemporaryDirectory(prefix="business-cup-browser-") as temp:
        url = "sqlite:///" + str(Path(temp) / "browser-test.db")
        # Alembic reads Settings() separately. These explicit values also override any local .env.
        os.environ.update(DATABASE_URL=url, APP_SECRET=SECRET, OPENAI_API_KEY="")
        command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
        from app.main import create_app
        from app.worker import Worker

        settings = Settings(
            _env_file=None,
            database_url=url,
            app_secret=SECRET,
            openai_api_key="",
            demo_mode=True,
            audio_data=Path(temp) / "audio",
            allowed_origins="http://127.0.0.1:4173",
        )
        app = create_app(settings)

        @app.get("/{path:path}", include_in_schema=False)
        def frontend(path: str):
            if path.startswith(("api/", "health/")):
                raise HTTPException(404)
            resource = (DIST / path).resolve()
            if resource.is_relative_to(DIST) and resource.is_file():
                return FileResponse(resource)
            return FileResponse(DIST / "index.html")

        stopped = threading.Event()
        worker = Worker(settings, app.state.database)

        def process_jobs():
            while not stopped.is_set():
                if not worker.run_once():
                    stopped.wait(0.1)

        thread = threading.Thread(target=process_jobs, name="browser-test-worker", daemon=True)
        thread.start()
        try:
            uvicorn.run(app, host="127.0.0.1", port=4173, log_level="warning")
        finally:
            stopped.set()
            thread.join(timeout=10)
            speech.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
