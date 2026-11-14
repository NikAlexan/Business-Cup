import copy
import json
from pathlib import Path

from app.db import iso, new_id

ROOT = Path(__file__).parent / "content"
CATALOG = json.loads((ROOT / "exercises.json").read_text())
EXERCISES = {x["id"]: x for x in CATALOG["items"]}
NOVEL_TEXTS = [
    "Early in the evening, a visitor reached the village library. She returned a book, asked about the local museum, and listened as the librarian described a small exhibition across the square.",
    "Along the coast, a group of friends prepared a simple picnic. They packed fresh bread, checked the weather, and chose a sheltered place where they could watch the boats return to shore.",
    "At the end of the garden, a wooden gate opened onto a narrow path. Two neighbors stopped to exchange a few words before continuing their walk toward the quiet railway station.",
]


def protocol(previous=None, variant=0):
    tasks = copy.deepcopy(json.loads((ROOT / "protocol.json").read_text()))
    for task in tasks:
        task.update(id=new_id(), recording_id=None, quality_status=None)
        if task["kind"] == "novel_text" and previous:
            # Avoid the immediately preceding novel prompt, even across many plan cycles.
            old = next(t["text"] for t in previous["tasks"] if t["kind"] == "novel_text")
            options = [t for t in NOVEL_TEXTS if t != old]
            task["text"] = options[variant % len(options)]
            task["prompt_version"] = f"novel-v1-{NOVEL_TEXTS.index(task['text']) + 4:02}"
        elif previous:
            old = next(t for t in previous["tasks"] if t["kind"] == task["kind"])
            task["text"], task["prompt_version"] = old["text"], old["prompt_version"]
    return tasks


def generate_plan(assessment, report, version):
    priorities = [p["tag"] for p in report["priorities"]]
    target_ids = []
    for p in report["priorities"]:
        for eid in p["exercise_ids"]:
            if eid not in target_ids and eid not in ("E01", "E12"):
                target_ids.append(eid)
    # Keep rotation varied using catalog tags, regardless of the model's chosen subset.
    for e in EXERCISES.values():
        if set(e["tags"]) & set(priorities) and e["id"] not in target_ids and e["id"] not in ("E01", "E12"):
            target_ids.append(e["id"])
    if not target_ids:
        target_ids = [e["id"] for e in EXERCISES.values() if set(e["tags"]) & set(priorities)]
    lessons = []
    for day in range(1, 15):
        chosen = [target_ids[(day - 1) % len(target_ids)]]
        if len(target_ids) > 1:
            chosen.append(target_ids[day % len(target_ids)])
        sequence = list(dict.fromkeys(["E01", *chosen, "E12"]))
        for general in ("E11", "E02", "E03"):
            if sum(EXERCISES[e]["duration_seconds"] for e in sequence) >= 300:
                break
            if general not in sequence:
                sequence.append(general)
        items = []
        for position, eid in enumerate(sequence, 1):
            ex = EXERCISES[eid]
            variant = ex["difficulty_variants"][0 if day <= 7 else 1]
            verification = ex["verification"]["type"]
            items.append(
                {
                    "id": new_id(),
                    "exercise_id": eid,
                    "exercise_version": ex["version"],
                    "position": position,
                    "difficulty": variant["id"],
                    "title": ex["title"],
                    "reason": "Warm up gently." if eid == "E01" else "Practice your assessment priorities.",
                    "status": "pending",
                    "latest_attempt_id": None,
                    "completed_at": None,
                    "estimated_duration_seconds": ex["duration_seconds"],
                    "task": {
                        "instruction": ex["instruction"],
                        "text": variant["text"],
                        "example": ex["example"],
                        "verification": {
                            "type": verification,
                            "min_elapsed_seconds": ex["verification"]["min_elapsed_seconds"],
                            "max_recording_seconds": 90 if verification == "recording" else None,
                            "target_wpm": {"min": 120, "max": 150} if eid == "E06" else None,
                        },
                    },
                }
            )
        lessons.append(
            {
                "id": new_id(),
                "day_index": day,
                "status": "available" if day == 1 else "locked",
                "estimated_duration_seconds": sum(i["estimated_duration_seconds"] for i in items),
                "completed_at": None,
                "items": items,
            }
        )
    return {
        "id": new_id(),
        "version": version,
        "assessment_id": assessment["id"],
        "status": "active",
        "created_at": iso(),
        "total_lessons": 14,
        "completed_lessons": 0,
        "priorities": priorities,
        "lessons": lessons,
    }
