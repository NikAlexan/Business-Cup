"""Explicit opt-in live API smoke test. Makes paid provider calls; deletes its guest afterwards."""

import argparse
import subprocess
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import httpx
import soundfile as sf

from app.provider import words


def run(base_url):
    client = httpx.Client(base_url=base_url, timeout=45)

    def post(path, payload):
        r = client.post("/api/v1" + path, json=payload, headers={"Idempotency-Key": str(uuid4())})
        r.raise_for_status()
        return r.json()

    def get(path):
        r = client.get("/api/v1" + path)
        r.raise_for_status()
        return r.json()

    def wait(jid):
        until = time.monotonic() + 300
        while time.monotonic() < until:
            j = get("/jobs/" + jid)
            if j["status"] in ("completed", "failed", "needs_rerecord"):
                if j["status"] != "completed":
                    raise RuntimeError(
                        "Job ended: " + str({k: j.get(k) for k in ("status", "error", "result")})
                    )
                return j
            time.sleep((j.get("poll_after_ms") or 2000) / 1000)
        raise TimeoutError("Job did not finish within five minutes")

    def upload_audio(text, fields, target_wpm=None):
        # This sample is synthesized test speech, never presented as a human user's result.
        with tempfile.TemporaryDirectory(prefix="voice-smoke-") as folder:
            p = Path(folder)
            (p / "text.txt").write_text(text)
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    f"flite=textfile={p / 'text.txt'}:voice=slt",
                    "-ar",
                    "16000",
                    str(p / "speech.wav"),
                ],
                check=True,
            )
            if target_wpm:
                estimated = len(words(text)) * 60 / sf.info(p / "speech.wav").duration
                factor = max(0.5, min(2, ((target_wpm["min"] + target_wpm["max"]) / 2) / estimated))
                subprocess.run(
                    [
                        "ffmpeg",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-i",
                        str(p / "speech.wav"),
                        "-af",
                        f"atempo={factor}",
                        str(p / "paced.wav"),
                    ],
                    check=True,
                )
                (p / "paced.wav").replace(p / "speech.wav")
            response = client.post(
                "/api/v1/recordings",
                data=fields,
                files={"file": ("speech.wav", (p / "speech.wav").read_bytes(), "audio/wav")},
                headers={"Idempotency-Key": str(uuid4())},
            )
            response.raise_for_status()
        data = response.json()
        wait(data["job_id"])
        return data["recording"]["id"]

    guest_created = False
    try:
        post(
            "/guest-session",
            {
                "timezone": "America/New_York",
                "locale": "en-US",
                "goal": "clear_speech",
                "consent": {"audio_processing": True, "policy_version": "2026-11-14"},
            },
        )
        guest_created = True
        a = post(
            "/assessments",
            {
                "kind": "initial",
                "recording_conditions": {
                    "device_label": "Synthetic smoke-test fixture",
                    "environment": "quiet_room",
                    "distance_cm": 20,
                },
            },
        )
        for task in a["tasks"]:
            upload_audio(
                task["text"], {"purpose": "assessment", "assessment_id": a["id"], "task_id": task["id"]}
            )
        j = post("/assessments/" + a["id"] + "/submit", {})
        wait(j["job_id"])
        a = get("/assessments/" + a["id"])
        assert a["report"]["summary"] and a["plan_id"]
        plan = get("/plan")
        assert len(plan["lessons"]) == 14
        today = get("/today")
        for item in today["lesson"]["items"]:
            kind = item["task"]["verification"]["type"]
            payload = {"plan_item_id": item["id"]}
            if kind == "timer":
                payload["elapsed_seconds"] = max(60, item["task"]["verification"]["min_elapsed_seconds"])
            elif kind == "self_confirmation":
                payload["self_confirmed"] = True
            else:
                payload["recording_id"] = upload_audio(
                    item["task"]["text"],
                    {"purpose": "exercise", "plan_item_id": item["id"]},
                    item["task"]["verification"].get("target_wpm"),
                )
            result = post("/exercise-attempts", payload)
            if result["status"] != "passed":
                raise RuntimeError("Exercise was not accepted: " + str(result["feedback"]))
        response = client.put("/api/v1/progress/" + today["lesson"]["id"], json={"status": "completed"})
        response.raise_for_status()
        assert get("/progress")["summary"]["completed_lessons_all_time"] == 1
        print(
            "PASS: live provider report, measured audio, 14-lesson plan, completed exercises, persisted lesson/streak"
        )
        print("Available scalar metrics:", sum(m.get("available", False) for m in a["measurements"].values()))
    finally:
        if guest_created:
            r = client.delete("/api/v1/guest-data")
            r.raise_for_status()
            print("Smoke-test guest and recordings deleted")
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--allow-paid-calls", action="store_true", required=True)
    args = parser.parse_args()
    run(args.base_url)
