# Exercise catalog and plan snapshots

Catalog `catalog-v3`, task schema 2. There are 12 exercise types and 20 original variants per type (240 total). The ten beginner and ten intermediate variants have separate identities, labels, texts, repetitions and listening/reflection prompts. The categories are original speaking practice based on vocal variety and comfortable voice use, not validated medical treatments.

## Content and practice

- Articulation warm-ups use concrete sequences with repetitions; comfortable vowels use three spoken passes. Both are untimed self-confirmation tasks.
- Endings, consonant groups and tongue twisters use multiple explicit passes, with clarity before speed.
- Steady pace uses full paragraphs; tempo contrast uses two passes of the same story at different comfortable speeds.
- Pauses and breath groups have slash-marked thought boundaries. Slashes are not spoken; breaths are optional wherever needed, never held.
- Intonation contrasts statements, questions and lists; emphasis changes the intended meaning over three passes without extra loudness.
- Narration uses original multi-sentence stories with a turn or discovery. Every variant includes a question to guide listening back.

## Saved task fields

`exercise_version` and `task.variant_id` identify issued content. `difficulty` is separate from the variant ID. `variant_label` is a user-facing subtitle.

`task.instruction` contains execution directions. `task.text` contains the script for recorded tasks. `task.repetitions` says how many complete passes to record. `task.steps` contains the action list for a warm-up. `task.reflection_prompt` guides the user's listening and is not an automated evaluation.

`task.verification` saves required metrics, quality thresholds and their version, advisory WPM band and the technical recording limit. Worker uses the snapshot for new plans. Legacy plans retain their saved text and can fall back to the existing catalog only when metric requirements were not yet saved. Removing a catalog exercise must not break a schema-2 task.

## Time semantics

- `expected_recording_seconds` is a flexible guide derived from script length, repetitions, comfortable reading speeds and marked thought boundaries. It never rejects a short or slow successful take.
- `estimated_practice_seconds` includes reading, listening back and 25 seconds for preparation/reflection. It is an estimate, not measured progress. Untimed action drills have their own planning estimate.
- `max_recording_seconds` is a generous technical cap (60–180 seconds), separate from guidance. It is calculated with extra room for pauses and slower reading and bounded by the server setting. The frontend uses the saved cap and server limit.
- Generated sessions target 300–480 estimated seconds, include a warm-up, personalized focus and a final narration, and add complementary practice when needed. Estimates do not promise that every person will spend exactly that long.
- `practice_seconds` is audio duration for a recorded attempt, reported elapsed time for a legacy timer, and zero for unknown untimed duration. `practice_seconds_source` distinguishes these. Self-confirmed estimated durations, including legacy ones, do not contribute to actual-time totals. Completion and notes still count.

## Rotation and feedback

Plan generation considers variant usage across prior plans, chooses the least-used variant within the day's difficulty, and updates usage within the new plan. The first and second halves introduce beginner and intermediate material. Exhausted pools rotate evenly; issued snapshots and history stay unchanged.

Audio issues such as silence or clipping require another take. Pace outside the drill's band is coaching, not a failed attempt. Missing credentials, rate limits or other expected provider failures during optional exercise transcription preserve accepted audio and return unavailable measurements with a reason. The full baseline/check-in assessment still requires its analysis to succeed.

The exercise screen restores saved attempt feedback through `latest_attempt_id`, shows available measured pace, and preserves the checked take for resending an attempt after a transport error. A full qualitative AI review and uncredited optional repeat after completion remain further work; quality checks do not claim to score diction or expression.

## Validation

`tests/test_content.py` checks catalog uniqueness, minimum variant counts, timing and snapshots, all single/pair priority combinations, six plan cycles and pool exhaustion. `tests/test_exercise_completion.py` covers advisory pace, optional transcription failures, removed live catalog entries, legacy timers and honest time accounting.
