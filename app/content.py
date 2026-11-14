import copy
import json
from pathlib import Path

from app.db import iso, new_id

ROOT = Path(__file__).parent / "content"
CATALOG = json.loads((ROOT / "exercises.json").read_text())
EXERCISES = {x["id"]: x for x in CATALOG["items"]}
NOVEL_TEXTS = [
    "Early in the evening, a visitor reached the village library just before it closed. She returned a heavy book about mountain birds, apologized for keeping it so long, and asked about the local museum. The librarian, glad to have someone to talk to, described a small exhibition across the square. There were maps, old photographs, and a wooden boat that fishermen had used a century ago. The visitor listened carefully, wrote a few notes in a tiny notebook, and promised to come back on Saturday. Outside, the streetlights flickered on, one by one, along the empty road.",
    "Along the coast, a group of friends prepared a simple picnic for the first warm day of spring. They packed fresh bread, cheese, and a basket of apples, checked the weather twice, and set off on foot. The path climbed slowly between the dunes, and the wind carried the sound of the waves. After an hour, they chose a sheltered place behind a low wall of rocks. From there, they could watch the fishing boats return to shore. Nobody said much for a while. They simply sat, ate, and enjoyed the quiet afternoon by the sea.",
    "At the end of the garden, a wooden gate opened onto a narrow path that led toward the railway station. Every morning, two neighbors met there by chance, or so they both pretended. One carried a newspaper under his arm, and the other walked a small, curious dog. They exchanged a few words about the weather, the price of coffee, and the trains that were always late. Then they continued their walk together, slowly, as if the station might wait for them. On rainy days, they shared one umbrella and laughed about it all the way.",
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
            task["prompt_version"] = f"novel-v2-{NOVEL_TEXTS.index(task['text']) + 4:02}"
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


TARGETS = json.loads((ROOT / "targets.json").read_text())
TARGETS_VERSION = TARGETS["version"]
UNITS = {"speaking_rate_wpm": "wpm", "pause_ratio": "ratio", "intonation_range_semitones": "semitones"}


def band(value, low, high):
    return "below" if value < low else "above" if value > high else "within"


def interpret(goal, measurements, previous):
    """Places each metric against the target of the assessment's goal; pitch is never scored."""
    g, labels = TARGETS["goals"][goal], TARGETS["labels"]
    value = lambda m, k: m[k]["value"] if m and m.get(k, {}).get("available") else None  # noqa: E731
    out = {}
    for key in ("speaking_rate_wpm", "pause_ratio"):
        v, t = value(measurements, key), {**g[key], "unit": UNITS[key]}
        b = band(v, t["min"], t["max"]) if v is not None else None
        out[key] = {"band": b, "target": t, "label": labels[key][b] if b else "Not measured", "note": ""}
    v, before = (
        value(measurements, "intonation_range_semitones"),
        value(previous, "intonation_range_semitones"),
    )
    lab = labels["intonation_range_semitones"]
    b = raw = None
    if v is not None and before is not None:
        raw = band(v, before - 1, before + 1)  # 1 st tolerance against the user's own baseline
        if g["intonation"] == "wider":
            b = "within" if raw == "above" else "below"
        elif g["intonation"] == "not_narrower":
            b = "below" if raw == "below" else "within"
    descr = None if v is None else lab["steady"] if v < 4 else lab["varied"] if v <= 8 else lab["wide"]
    out["intonation_range_semitones"] = {
        "band": b,
        "target": None,
        "label": lab[raw] if raw else descr or "Not measured",
        "note": f"your baseline {before:g} semitones" if raw else "your starting point",
    }
    out["f0_median_hz"] = {
        "band": None,
        "target": None,
        "label": "Your natural pitch",
        "note": "for reference, not a score",
    }
    for key, r in out.items():
        r["focus"] = key in g["focus"] and r["band"] not in (None, "within")
    return out
