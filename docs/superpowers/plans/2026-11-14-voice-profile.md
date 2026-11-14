# Voice Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The voice profile shows each metric as a word, a number and the distance to the target of the user's goal, with correct pause counting and an AI review grounded in measurements.

**Architecture:** Pace and pauses come from OpenAI `whisper-1` word timestamps over two ~45-second reading passages (tasks 1 + 2). Targets live in `app/content/targets.json`; `app/content.py:interpret()` turns goal + measurements (+ previous assessment for intonation) into per-metric `band/target/focus/label`. The worker stores it as `assessment.interpretation` and passes it to the report prompt. The frontend renders tiles (variant B) from `interpretation`, takes exercise titles from `GET /api/v1/exercises`.

**Tech Stack:** Python 3 / FastAPI / Silero VAD / librosa; React + TS + Vite + vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-voice-profile-design.md`

## Global Constraints

- UI copy in English; never "normal", "typical", "average", "below norm".
- Pitch is never scored: band `null`, label "Your natural pitch", note "for reference, not a score".
- Unavailable metric stays "Not measured", never 0.
- `report.limitations` is not rendered.
- Exercises shown by title, never by id.
- Targets (verbatim from spec):

| goal | focus | pace wpm | pause ratio | intonation |
|---|---|---|---|---|
| clear_speech | pace, pauses | 130–160 | 0.14–0.22 | reference vs self |
| expressive_voice | intonation, pauses | 140–170 | 0.12–0.20 | wider than own baseline |
| confident_delivery | pace, pauses | 150–190 | 0.09–0.14 | not narrower than own baseline |

- `protocol_version` → `assessment-v2`; `measurement_version` → `voice-metrics-v2`; `analysis_metadata.targets_version` = `targets-v1`.
- Checks: `ruff check app tests`, `pytest -q`, in `frontend/`: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.

## Review Focus

1. Old completed assessments without `interpretation` → profile renders as before (number + note), no crash. Test in Task 4.
2. Pace unavailable (`transcription_unavailable`) → pace tile "Not measured", `interpretation.speaking_rate_wpm.band is None`, no focus tag. Test in Task 2.
3. Recording with long leading/trailing silence → pace and pause ratio unchanged by edge silence. Test in Task 1.
6. Transcription unverified on one reading task → pace and pauses "Not measured", not computed from half the data. Test in Task 3 (`combine_timing`).
4. Reassessment with previous intonation unavailable → intonation band `null`, label "your starting point". Test in Task 2.
5. Goal changed in Settings after baseline → interpretation uses the goal stored on the assessment (`assessment["goal"]`), not current preferences. Test in Task 3.

---

### Task 0: Longer reading protocol

**Why:** today pace, pauses and pitch come from task 1 alone (22 words, ~8 s, 1–2 places to pause); one extra pause moves the ratio by 6 points against a 9–14 % target. The sources behind the targets measured ~1 minute of reading. Task 3 (intonation drill) is exaggerated on purpose and does not reflect delivery.

**Files:**
- Modify: `app/content/protocol.json`, `app/content.py` (`NOVEL_TEXTS`), `app/service.py:293` (`protocol_version`)
- Modify: `tests/conftest.py` (`speech_file` text), `tests/test_api.py` if it asserts old texts

**Interfaces:**
- Produces: tasks 1 (`control_text`) and 2 (`novel_text`) are reading passages of 85–110 words each (~70 s together); task 3 is a short connected text with intonation contrasts (`intonation-v2`), evaluated only by the report model. `protocol_version` = `assessment-v2`.

- [ ] **Step 1: Write failing test** in `tests/test_api.py`:

```python
def test_reading_tasks_are_long_enough():
    from app.content import NOVEL_TEXTS, protocol
    tasks = protocol()
    assert 85 <= len(tasks[0]["text"].split()) <= 110
    assert all(85 <= len(t.split()) <= 110 for t in NOVEL_TEXTS)
    assert len({t["prompt_version"] for t in tasks}) == 3
    assert tasks[2]["prompt_version"] == "intonation-v2" and "?" in tasks[2]["text"] and "!" in tasks[2]["text"]
```

- [ ] **Step 2: Run** `pytest tests/test_api.py::test_reading_tasks_are_long_enough -v` — FAIL.
- [ ] **Step 3: Implement.**
  - `control_text` = first paragraph of the Rainbow Passage (Fairbanks 1960, public domain; standard voice-assessment passage), verbatim:
    "When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. The rainbow is a division of white light into many beautiful colors. These take the shape of a long round arch, with its path high above, and its two ends apparently beyond the horizon. There is, according to legend, a boiling pot of gold at one end. People look, but no one ever finds it. When a man looks for something beyond his reach, his friends say he is looking for the pot of gold at the end of the rainbow."
    `prompt_version` `control-v2`, `target_duration_seconds` 40, instruction "Read naturally, the way you would read to a listener."
  - `novel_text` and all `NOVEL_TEXTS`: rewrite as 4 everyday narrative passages of 85–110 words (several sentences of mixed length, commas, no dialogue, no rare words); keep the "avoid previous variant" rule; `prompt_version` `novel-v2-NN`; `target_duration_seconds` 40.
  - `intonation` task: text verbatim "Did you hear the news? The bakery on the corner is finally open! They sell bread, pastries, and fresh coffee. I didn't say it was cheap — I said it was good. So, are you coming with me tomorrow, or not?"; `prompt_version` `intonation-v2`; instruction "Read it as if you were telling a friend."; `target_duration_seconds` 20. The UI renders `cheap`/`good` stress only if the reading screen already supports emphasis markup; otherwise plain text.
  - `protocol_version` → `assessment-v2` (old baselines stop comparing; only test data exists).
  - `speech_file` fixture: read the control text so tests use the real protocol length.
- [ ] **Step 4: Run** `pytest -q` — PASS. Commit.

### Task 1: Pauses and pace from word timestamps

**Diagnosis (done 2026-11-14 on a real baseline):** Silero VAD keeps speech probability ≥ 0.5 through most sentence pauses (0 pauses on task 1, where pauses are audible); edge silence of 0.5–2.6 s is counted in the duration and lowers pace. Energy thresholds and the local zipformer ASR were tried and rejected (ASR timestamps unreliable on poor recognition). OpenAI `whisper-1` with word timestamps put pauses exactly at commas and sentence ends (2 / 4 / 1 pauses on the three tasks).

**Files:**
- Modify: `app/config.py` (`transcribe_model` → `"whisper-1"`), `app/provider.py:75-94` (`transcribe`), `app/audio.py:193-213` (`timing_metrics`), `app/worker.py:208-212` (exercise path)
- Modify: `tests/conftest.py` (`FakeProvider.transcribe`), `tests/test_provider.py`
- Create: `tests/test_audio.py`

**Interfaces:**
- Produces: `provider.transcribe(signal, expected_text)` returns as before plus `"words": [{"start": float, "end": float}, ...]` (seconds; `[]` when unverified). Request: `response_format=verbose_json`, `timestamp_granularities[]=word`.
- Produces: `timing_metrics(signal, segments, word_count=None, words=None) -> dict`, same keys. With `words` (≥ 2): span = `words[-1]["end"] - words[0]["start"]`; pauses = gaps between consecutive words ≥ 0.3 s; `speaking_rate_wpm` = word_count / span; `pause_ratio` = pause time / span; `articulation_rate_wpm` = word_count / (span − pause time). Without `words`: all five metrics unavailable, reason `transcription_unavailable` (never 0). `segments` stays for quality checks only.

- [ ] **Step 1: Write failing tests.**
  - `tests/test_audio.py`:

```python
W = lambda *spans: [{"start": a, "end": b} for a, b in spans]

def test_pauses_are_gaps_between_words():
    m = timing_metrics(np.zeros(16000 * 10), [], 4, W((1, 2), (2.1, 3), (3.6, 4), (5, 6)))
    assert m["pause_count"]["value"] == 2              # 0.6 and 1.0; 0.1 is not a pause
    assert m["pause_total_seconds"]["value"] == 1.6
    assert m["pause_ratio"]["value"] == 0.32            # 1.6 / 5 s span
    assert m["speaking_rate_wpm"]["value"] == 48        # 4 words / 5 s

def test_edge_silence_is_ignored():
    w = W((1, 2), (2.5, 3))
    assert timing_metrics(np.zeros(16000 * 4), [], 2, w) == timing_metrics(np.zeros(16000 * 30), [], 2, w)

def test_no_words_means_unavailable_not_zero():
    m = timing_metrics(np.zeros(16000 * 5), [(0, 16000)], None, None)
    assert all(not m[k]["available"] and m[k]["value"] is None for k in m)
```

  - `tests/test_provider.py`: the transcription mock returns `verbose_json` with `words`; assert the request carries `timestamp_granularities[]=word` and `transcribe(...)["words"]` has start/end; unverified → `words == []`.
- [ ] **Step 2: Run** `pytest tests/test_audio.py tests/test_provider.py -v` — FAIL.
- [ ] **Step 3: Implement** per Interfaces. `FakeProvider.transcribe` returns evenly spaced words (0.3 s each, 0.05 s gaps, a 0.5 s gap after every sentence end in `text`) so flows still produce pauses. Exercise path passes `transcript["words"]`.
- [ ] **Step 4: Run** `ruff check app tests && pytest -q` — PASS (incl. `test_pace_exercise_uses_verified_transcription`). Commit.

### Task 2: Targets and interpretation

**Files:**
- Create: `app/content/targets.json`
- Modify: `app/content.py`
- Create: `tests/test_targets.py`

**Interfaces:**
- Produces: `interpret(goal: str, measurements: dict, previous: dict | None) -> dict[str, dict]`, keys `speaking_rate_wpm`, `pause_ratio`, `intonation_range_semitones`, `f0_median_hz`; each value `{"band": "below"|"within"|"above"|None, "target": {"min": float, "max": float, "unit": str} | None, "focus": bool, "label": str, "note": str}`. `previous` = previous assessment's `measurements` or `None`. `TARGETS_VERSION = "targets-v1"`.

`targets.json` holds per-goal `focus` list, `pace` and `pauses` min/max, `intonation` rule (`"reference"`, `"wider"`, `"not_narrower"`), and English labels per metric × band. Label drafts (implementer may polish within Global Constraints):
- pace: below "Calm, unhurried", within "On target", above "Brisk";
- pauses: below "Few pauses", within "Well-placed pauses", above "Long gaps";
- intonation: no baseline "your starting point" as note, label from value (`< 4` "Steady", `4–8` "Varied", `> 8` "Wide, lively"); with baseline: compare to previous with 1 st tolerance;
- pitch: label "Your natural pitch", note "for reference, not a score".

`focus` = metric in goal's focus list AND band not `within` AND band not `None`.

- [ ] **Step 1: Write failing tests**

```python
M = lambda wpm, ratio, st: {"speaking_rate_wpm": av(wpm), "pause_ratio": av(ratio),
                            "intonation_range_semitones": av(st), "f0_median_hz": av(88)}

def test_confident_slow_pace_is_below_and_focus():
    r = interpret("confident_delivery", M(111, 0.31, 9), None)
    assert r["speaking_rate_wpm"]["band"] == "below"
    assert r["speaking_rate_wpm"]["target"] == {"min": 150, "max": 190, "unit": "wpm"}
    assert r["speaking_rate_wpm"]["focus"] is True
    assert r["pause_ratio"]["band"] == "above"

def test_clear_speech_targets():
    r = interpret("clear_speech", M(145, 0.18, 9), None)
    assert r["speaking_rate_wpm"]["band"] == "within" and not r["speaking_rate_wpm"]["focus"]
    assert r["pause_ratio"]["target"]["min"] == 0.14

def test_pitch_is_never_scored():
    r = interpret("expressive_voice", M(150, 0.15, 9), None)
    assert r["f0_median_hz"]["band"] is None and r["f0_median_hz"]["focus"] is False

def test_unavailable_metric_has_no_band():
    m = M(150, 0.15, 9); m["speaking_rate_wpm"] = {"available": False, "value": None, "unit": "words/min", "unavailable_reason": "transcription_unavailable"}
    r = interpret("confident_delivery", m, None)
    assert r["speaking_rate_wpm"]["band"] is None and r["speaking_rate_wpm"]["focus"] is False

def test_intonation_vs_baseline():
    assert interpret("expressive_voice", M(150, .15, 6), M(150, .15, 9))["intonation_range_semitones"]["band"] == "below"
    assert interpret("expressive_voice", M(150, .15, 6), None)["intonation_range_semitones"]["band"] is None
    prev = M(150, .15, 9); prev["intonation_range_semitones"] = {"available": False, "value": None, "unit": "semitones", "unavailable_reason": "insufficient_voiced_audio"}
    assert interpret("expressive_voice", M(150, .15, 6), prev)["intonation_range_semitones"]["band"] is None

def test_no_forbidden_words_in_copy():
    text = (Path("app/content/targets.json")).read_text().lower()
    assert not any(w in text for w in ["normal", "typical", "average"])
```

- [ ] **Step 2: Run** `pytest tests/test_targets.py -v` — FAIL (no `interpret`).
- [ ] **Step 3: Implement** `targets.json` and `interpret()` per Interfaces.
- [ ] **Step 4: Run** `pytest tests/test_targets.py -v` — PASS. Commit.

### Task 3: Worker wiring and grounded report prompt

**Files:**
- Modify: `app/worker.py:238-325`, `app/provider.py:96-135`
- Modify: `tests/test_api.py`, `tests/test_provider.py`

**Interfaces:**
- Consumes: `interpret`, `TARGETS_VERSION` (Task 2).
- Produces: completed assessment has `interpretation` (Task 2 shape) and `analysis_metadata.targets_version`. `provider.report(signals, assessment, measurements, comparison, interpretation)` — new last parameter; `FakeProvider.report` in `tests/conftest.py` gains it.

- [ ] **Step 1: Write failing tests.**
  - In `test_full_flow_plan_attempts_streak_and_reassessment`: after baseline, `a = get(f"/assessments/{id}")`; assert `set(a["interpretation"]) == {"speaking_rate_wpm","pause_ratio","intonation_range_semitones","f0_median_hz"}` and `a["analysis_metadata"]["targets_version"] == "targets-v1"`.
  - New `test_interpretation_uses_assessment_goal`: create session with goal `confident_delivery`, run baseline, PATCH preferences goal to `clear_speech`, GET assessment; `interpretation["speaking_rate_wpm"]["target"]["min"] == 150`.
  - `tests/test_audio.py::test_combine_timing`: two available tasks (10 words / 5 s span / 1 s pause and 20 words / 10 s / 2 s) → 80 wpm, ratio 0.2, 3 pauses; one unavailable → all unavailable.
  - Assert `a["measurement_scope"]["pace_and_pauses_task_ids"] == [tasks[0].id, tasks[1].id]` and `a["analysis_metadata"]["measurement_version"] == "voice-metrics-v2"`.
  - In `tests/test_provider.py`: the report request text contains `"interpretation"` and `"target"` and the sentence forbidding generic phrases (see Step 3).
- [ ] **Step 2: Run** `pytest -q` — new assertions FAIL.
- [ ] **Step 3: Implement.**
  - Measurements over reading (tasks 1 + 2): transcribe each of `signals[0]`, `signals[1]` with its own text; timing = `timing_metrics` per task, then combine by summing words, spans and pause time (helper `combine_timing(a, b) -> dict` in `app/audio.py`; unavailable if either is); pitch and `intonation_range_semitones` from `np.concatenate(signals[:2])`. Task 3 goes only to the report model. `measurement_scope` lists task 1 + 2 ids for all three groups. `measurement_version` → `voice-metrics-v2`.
  - `compare()`: replace the hard-coded `"voice-metrics-v1"` with equality of both assessments' `measurement_version`; test: two v2 assessments compare, a v1 vs v2 pair is `available: False`.
  - Worker: after `measurements`, `interpretation = interpret(a["goal"], measurements, previous["measurements"] if previous else None)`; pass to `provider.report`; save on `a` with `targets_version`.
  - Prompt (`app/provider.py`): add `"goal"`, `"interpretation"` to `context`. Replace the qualitative sentences with: every observation must cite a measured number or a specific moment in a recording; no generic phrases such as "fairly clear" or "seems consistent"; priorities come from focus metrics outside target or from concrete diction observations; `limitations` are internal notes for developers, keep them short. Keep the existing no-diagnosis, no-pitch-judgement, untrusted-instructions rules.
- [ ] **Step 4: Run** `ruff check app tests && pytest -q` — PASS. Commit.

### Task 4: Profile screen, variant B

**Files:**
- Modify: `frontend/src/api/types.ts` (`Assessment.interpretation?`, `Interpretation` type matching Task 2)
- Modify: `frontend/src/components/MetricTile.tsx`, `frontend/src/screens/Profile.tsx`
- Create: `frontend/src/lib/profile.test.ts` (tests the pure helper)
- Create: `frontend/src/lib/profile.ts`

**Interfaces:**
- Consumes: `assessment.interpretation` (Task 3), `GET /api/v1/exercises` → `Exercise[]` (existing type).
- Produces: `targetLine(spec: MetricSpec, m: Measurement, i: MetricInterpretation | undefined): string`, e.g. `"111 wpm · your target 150–190"`, `"31 % · target 9–14 %"`, `"9 semitones · your starting point"`, `"88 Hz · for reference, not a score"`; without `i` returns today's number + note.

- [ ] **Step 1: Write failing vitest** for `targetLine`: the four example strings above; missing interpretation → `"111 wpm"` plus existing note; pause ratio scaled ×100 and rounded.
- [ ] **Step 2: Run** `npx vitest run src/lib/profile.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
  - `profile.ts`: `targetLine`.
  - `MetricTile`: label row with "Working on this" badge when `i.focus`; big text = `i.label` (fallback: the number as today); small line = `targetLine`. Reassessment keeps "Was X · ±Δ" line under it. Tile order: pace, pauses, intonation, pitch.
  - `Profile`: drop `limitations` from the text; one fixed line "These are observations from your recordings, not a diagnosis."; priorities meta = `reason · titles` where titles come from a `useExercises()` query (add to `api/hooks.ts` if absent), falling back to nothing (never the id).
  - Read `design/screens/Profile.html` for grid, spacing and tokens; reuse `.rs-metric`, `.rs-badge`, `--sun`.
- [ ] **Step 4: Run** `npx tsc --noEmit && npx vitest run && npx vite build` — PASS.
- [ ] **Step 5: Look at it.** `docker compose up --build`, record a baseline, open the profile at 390 / 820 / 1280 px; check against the spec sketch and an old assessment without `interpretation`. Commit.
