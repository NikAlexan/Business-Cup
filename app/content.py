import copy
import json
import math
import re
from collections import Counter
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


def variant_timing(variant, verification):
    """Planning guidance, never a completion gate. Reading time includes all requested passes."""
    repetitions = variant["repetitions"]
    words = len(re.findall(r"\b[\w’'-]+\b", variant["text"])) * repetitions
    low = max(5, math.ceil(words * 60 / 180))
    high = max(low, math.ceil(words * 60 / 90))
    if verification == "self_confirmation":
        return {
            "expected_recording_seconds": None,
            "estimated_practice_seconds": max(
                variant["action_duration_seconds"],
                math.ceil(words * 60 / 140) + (repetitions - 1) * 3 + 10,
            )
            if repetitions > 1
            else variant["action_duration_seconds"],
            "max_recording_seconds": None,
            "includes_listening": False,
        }
    # Two seconds per thought boundary; a normal breath between repeated passes.
    pause_allowance = variant["text"].count("/") * 2 + (repetitions - 1) * 3
    low += pause_allowance
    high += pause_allowance
    reading = math.ceil(words * 60 / 140) + pause_allowance
    return {
        "expected_recording_seconds": {"min": low, "max": high},
        "estimated_practice_seconds": reading * 2 + 25,  # read + listen + preparation/reflection
        "max_recording_seconds": min(180, max(60, math.ceil((high + 20) / 5) * 5)),
        "includes_listening": True,
    }


def generate_plan(assessment, report, version, previous_plans=()):
    priorities = [p["tag"] for p in report["priorities"]]
    groups = []
    for priority in report["priorities"]:
        matching = [
            eid
            for eid, ex in EXERCISES.items()
            if priority["tag"] in ex["tags"] and eid not in ("E01", "E12")
        ]
        recommended = [eid for eid in priority["exercise_ids"] if eid in matching]
        if matching:
            groups.append(
                {
                    "tag": priority["tag"],
                    "ids": recommended or matching,
                    "matching": matching,
                    "reason": priority.get("reason"),
                }
            )
    if not groups:
        groups = [
            {"tag": "clarity", "ids": ["E03", "E04"], "matching": ["E03", "E04"], "reason": None},
            {"tag": "intonation", "ids": ["E09", "E10"], "matching": ["E09", "E10"], "reason": None},
        ]
    history_items = [item for p in previous_plans for lesson in p["lessons"] for item in lesson["items"]]
    usage = Counter(item["task"].get("variant_id") for item in history_items)
    continued = {
        item["exercise_id"]
        for item in history_items
        if item["status"] == "completed" and item.get("difficulty") == "intermediate"
    }
    focus_uses, complementary_uses, current_variants = Counter(), Counter(), Counter()
    reasons = {}

    def make_item(eid, day, position):
        ex = EXERCISES[eid]
        difficulty = "intermediate" if eid in continued or day > 7 else "beginner"
        pool = [v for v in ex["difficulty_variants"] if v["difficulty"] == difficulty]
        offset = (version - 1) % len(pool)
        pool = pool[offset:] + pool[:offset]
        variant = min(pool, key=lambda v: (current_variants[v["id"]], usage[v["id"]]))
        usage[variant["id"]] += 1
        current_variants[variant["id"]] += 1
        verification = ex["verification"]["type"]
        timing = variant_timing(variant, verification)
        return {
            "id": new_id(),
            "exercise_id": eid,
            "exercise_version": ex["version"],
            "position": position,
            "difficulty": difficulty,
            "variant_label": variant["label"],
            "title": ex["title"],
            "reason": "Warm up gently."
            if eid == "E01"
            else "Bring the skills together in a new story."
            if eid == "E12"
            else reasons.get(eid, "Balance your focus work with a complementary speaking skill."),
            "difficulty_basis": "previous_practice" if eid in continued else "plan_progression",
            "status": "pending",
            "latest_attempt_id": None,
            "completed_at": None,
            "estimated_duration_seconds": timing["estimated_practice_seconds"],
            "task": {
                "schema_version": 2,
                "variant_id": variant["id"],
                "instruction": variant["instruction"],
                "text": variant["text"],
                "steps": [step.strip() + "." for step in variant["text"].rstrip(".").split(". ")]
                if eid == "E01"
                else [],
                "repetitions": variant["repetitions"],
                "timing": timing,
                "reflection_prompt": variant["reflection_prompt"],
                "example": copy.deepcopy(ex["example"]),
                "verification": {
                    "type": verification,
                    "min_elapsed_seconds": None,
                    "required_metrics": list(ex["verification"]["required_metrics"]),
                    "max_recording_seconds": timing["max_recording_seconds"],
                    "target_wpm": {"min": 120, "max": 150} if eid == "E06" else None,
                    "quality_rules_version": "audio-quality-v1",
                    "quality_rules": copy.deepcopy(CATALOG["quality_rules"]),
                },
            },
        }

    lessons = []
    for day in range(1, 15):
        chosen = []
        reasons = {}
        for group in groups[:2]:
            candidates = [eid for eid in group["ids"] if eid not in chosen]
            if not candidates:
                candidates = [eid for eid in group["matching"] if eid not in chosen]
            if candidates:
                eid = min(candidates, key=lambda eid: focus_uses[eid])
                chosen.append(eid)
                focus_uses[eid] += 1
                reasons[eid] = group["reason"] or f"Practice your {group['tag']} focus."
        if len(chosen) == 1:
            related = [eid for eid in groups[0]["matching"] if eid not in chosen]
            if related:
                eid = min(related, key=lambda eid: complementary_uses[eid])
                chosen.append(eid)
                complementary_uses[eid] += 1
                reasons[eid] = f"Explore another way to practice {groups[0]['tag']}."
        sequence = ["E01", *chosen]
        items = [make_item(eid, day, n) for n, eid in enumerate(sequence, 1)]
        narration = make_item("E12", day, 0)
        remaining = [eid for eid in EXERCISES if eid not in (*sequence, "E12")]
        while sum(i["estimated_duration_seconds"] for i in [*items, narration]) < 300 and remaining:
            eid = min(remaining, key=lambda eid: complementary_uses[eid])
            remaining.remove(eid)
            complementary_uses[eid] += 1
            items.append(make_item(eid, day, len(items) + 1))
        narration["position"] = len(items) + 1
        items.append(narration)
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
        "catalog_version": CATALOG["catalog_version"],
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
