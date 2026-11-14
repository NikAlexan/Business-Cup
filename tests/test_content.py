"""Catalog quality and multi-cycle plan invariants, independent of paid model calls."""

import copy
from collections import Counter
from itertools import combinations

import pytest

from app.content import CATALOG, EXERCISES, generate_plan, variant_timing


def report(*tags):
    return {"priorities": [{"tag": tag, "exercise_ids": []} for tag in tags]}


def test_every_type_has_twenty_original_variants_and_separate_instructions():
    assert len(EXERCISES) == 12
    ids = []
    for ex in EXERCISES.values():
        variants = ex["difficulty_variants"]
        assert len(variants) >= 20
        assert len({v["text"] for v in variants}) == len(variants)
        assert Counter(v["difficulty"] for v in variants) == {"beginner": 10, "intermediate": 10}
        for v in variants:
            ids.append(v["id"])
            assert v["instruction"] and v["reflection_prompt"] and v["label"]
            assert v["repetitions"] >= 1
            if ex["verification"]["type"] == "recording":
                assert len(v["text"].split()) * v["repetitions"] >= 25
                assert "Take a comfortable breath, then read" not in v["text"]
                assert v["instruction"] not in v["text"]
                timing = variant_timing(v, "recording")
                assert timing["expected_recording_seconds"]["max"] < timing["max_recording_seconds"] <= 180
    assert len(ids) == len(set(ids))


def test_every_spoken_script_is_distinct_across_the_catalog():
    scripts = [v["text"] for e in EXERCISES.values() for v in e["difficulty_variants"]]
    assert len(scripts) == len(set(scripts))


TAGS = ["clarity", "pace", "pauses", "intonation", "expressiveness", "breath", "delivery", "articulation"]


@pytest.mark.parametrize("tags", [()] + [(t,) for t in TAGS] + list(combinations(TAGS, 2)))
def test_sessions_have_honest_estimates_and_complete_snapshots(tags):
    plan = generate_plan({"id": "assessment"}, report(*tags), 1)
    assert plan["catalog_version"] == CATALOG["catalog_version"]
    assert len(plan["lessons"]) == 14
    for day, lesson in enumerate(plan["lessons"], 1):
        assert 300 <= lesson["estimated_duration_seconds"] <= 480
        assert (
            sum(i["estimated_duration_seconds"] for i in lesson["items"])
            == lesson["estimated_duration_seconds"]
        )
        assert lesson["items"][0]["exercise_id"] == "E01"
        assert lesson["items"][-1]["exercise_id"] == "E12"
        assert len({i["exercise_id"] for i in lesson["items"]}) == len(lesson["items"])
        for position, item in enumerate(lesson["items"], 1):
            assert item["position"] == position
            assert item["difficulty"] == ("beginner" if day <= 7 else "intermediate")
            task = item["task"]
            assert task["variant_id"] and task["schema_version"] == 2
            assert task["verification"]["min_elapsed_seconds"] is None
            assert task["verification"]["quality_rules"] == CATALOG["quality_rules"]
            assert "required_metrics" in task["verification"]


def test_rotation_uses_all_warmups_before_reusing_a_variant_and_balances_exhaustion():
    plans = []
    for version in range(1, 7):
        plans.append(generate_plan({"id": str(version)}, report("clarity", "intonation"), version, plans))
    warmups = [lesson["items"][0]["task"]["variant_id"] for p in plans for lesson in p["lessons"]]
    assert len(set(warmups[:14])) == 14
    assert len(set(warmups[:28])) == 20
    counts = Counter(warmups)
    assert max(counts.values()) - min(counts.values()) <= 1
    for plan in plans:
        for eid in EXERCISES:
            variants = [
                i["task"]["variant_id"]
                for lesson in plan["lessons"]
                for i in lesson["items"]
                if i["exercise_id"] == eid
            ]
            assert len(variants) == len(set(variants))


def test_snapshots_do_not_share_catalog_objects_or_modify_history():
    first = generate_plan({"id": "first"}, report("pace"), 1)
    history = copy.deepcopy(first)
    second = generate_plan({"id": "second"}, report("pace"), 2, [first])
    assert first == history
    first["lessons"][0]["items"][0]["task"]["verification"]["quality_rules"]["max_clipping_ratio"] = 0.99
    assert CATALOG["quality_rules"]["max_clipping_ratio"] == 0.02
    assert (
        second["lessons"][0]["items"][0]["task"]["verification"]["quality_rules"]["max_clipping_ratio"]
        == 0.02
    )
