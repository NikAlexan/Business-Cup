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
        assert Counter(v["difficulty"] for v in variants) == {"beginner": 10, "intermediate": 14}
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
@pytest.mark.parametrize("experienced", [False, True])
def test_sessions_have_honest_estimates_and_complete_snapshots(tags, experienced):
    previous, continued = [], set()
    if experienced:
        old = generate_plan({"id": "old"}, report(*tags), 1)
        for lesson in old["lessons"]:
            for item in lesson["items"]:
                item["status"] = "completed"
                if item["difficulty"] == "intermediate":
                    continued.add(item["exercise_id"])
        previous.append(old)
    plan = generate_plan({"id": "assessment"}, report(*tags), 2 if experienced else 1, previous)
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
            assert item["difficulty"] == (
                "intermediate" if item["exercise_id"] in continued or day > 7 else "beginner"
            )
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
    assert len(set(warmups[:42])) == 24
    for difficulty in ("beginner", "intermediate"):
        counts = Counter(
            lesson["items"][0]["task"]["variant_id"]
            for p in plans
            for lesson in p["lessons"]
            if lesson["items"][0]["difficulty"] == difficulty
        )
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


def test_explicitly_recommended_pace_is_daily_and_complementary_skills_rotate():
    plan = generate_plan(
        {"id": "assessment"},
        {"priorities": [{"tag": "pace", "exercise_ids": ["E06"], "reason": "Practice a steadier pace."}]},
        1,
    )
    counts = Counter(i["exercise_id"] for lesson in plan["lessons"] for i in lesson["items"])
    assert counts["E06"] == 14
    assert 0 < counts["E11"] < 10
    assert len([eid for eid, count in counts.items() if count > 0]) >= 9
    for lesson in plan["lessons"]:
        target = next(i for i in lesson["items"] if i["exercise_id"] == "E06")
        assert target["reason"] == "Practice a steadier pace."


def test_actual_intermediate_practice_continues_without_downgrading_or_repeating_within_plan():
    first = generate_plan({"id": "first"}, report("pace"), 1)
    # An issued advanced lesson is not experience until it has actually been practiced.
    untouched = generate_plan({"id": "untouched"}, report("pace"), 2, [first])
    assert untouched["lessons"][0]["items"][0]["difficulty"] == "beginner"
    for item in first["lessons"][7]["items"]:
        item["status"] = "completed"
    next_plan = generate_plan({"id": "next"}, report("pace"), 2, [first])
    warmups = [lesson["items"][0] for lesson in next_plan["lessons"]]
    assert all(
        i["difficulty"] == "intermediate" and i["difficulty_basis"] == "previous_practice" for i in warmups
    )
    assert len({i["task"]["variant_id"] for i in warmups}) == 14


def test_each_of_two_priorities_is_represented_every_day():
    plan = generate_plan(
        {"id": "assessment"},
        {
            "priorities": [
                {"tag": "clarity", "exercise_ids": ["E03", "E04"]},
                {"tag": "intonation", "exercise_ids": ["E09", "E10"]},
            ]
        },
        1,
    )
    for lesson in plan["lessons"]:
        ids = {i["exercise_id"] for i in lesson["items"]}
        assert ids & {"E03", "E04"}
        assert ids & {"E09", "E10"}


def test_articulation_focus_selects_relevant_speech_work_beyond_the_warmup():
    plan = generate_plan(
        {"id": "assessment"}, {"priorities": [{"tag": "articulation", "exercise_ids": ["E01"]}]}, 1
    )
    for lesson in plan["lessons"]:
        assert any(i["exercise_id"] in {"E02", "E03", "E04", "E05"} for i in lesson["items"])
        assert any("articulation" in i["reason"] for i in lesson["items"])


def test_untimed_vowel_estimates_include_all_three_rounds():
    for variant in EXERCISES["E02"]["difficulty_variants"]:
        estimate = variant_timing(variant, "self_confirmation")
        assert (
            estimate["estimated_practice_seconds"]
            >= len(variant["text"].split()) * variant["repetitions"] / 140 * 60
        )
        assert estimate["max_recording_seconds"] is None
