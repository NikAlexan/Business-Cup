FROM python:3.12.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    AUDIO_DATA=/data/audio VAD_MODEL_PATH=/app/models/silero_vad.onnx ASR_MODEL_DIR=/app/models/asr \
    NUMBA_CACHE_DIR=/tmp/numba
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY scripts-download-vad.py .
RUN python scripts-download-vad.py
COPY app app
COPY migrations migrations
COPY alembic.ini .
RUN groupadd --gid 10001 appuser && useradd --create-home --uid 10001 --gid 10001 appuser \
    && mkdir -p /data/audio && chown -R appuser:appuser /data /app
USER appuser
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
