# Exercise catalog and plan snapshots

Catalog `catalog-v6`, task schema 2. There are 12 exercise types and 24 original variants per type (288 total). The ten beginner and fourteen intermediate variants have separate identities, labels, texts, repetitions and listening/reflection prompts. The categories are original speaking practice based on vocal variety and comfortable voice use, not validated medical treatments.

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

Plan generation considers variant usage across prior plans, chooses the least-used variant within the day's difficulty, and updates usage within the new plan. The first and second halves introduce beginner and intermediate material for new practitioners. A completed intermediate task preserves that practice level for its exercise in the next plan; issued-but-unpracticed tasks do not imply experience or mastery. Recommended skills anchor each day; complementary skills rotate rather than always favoring breath work. Exhausted pools rotate evenly; issued snapshots and history stay unchanged.

Audio issues such as silence or clipping require another take. Pace outside the drill's band is coaching, not a failed attempt. Missing credentials, rate limits or other expected provider failures during optional exercise transcription preserve accepted audio and return unavailable measurements with a reason. The full baseline/check-in assessment still requires its analysis to succeed.

The exercise screen restores saved attempt feedback through `latest_attempt_id`, shows available measured pace, and preserves the checked take for resending an attempt after a transport error. Completed takes can be played beside their saved feedback, including after reload. Optional background audio-model coaching is described below; audio quality itself does not score diction or expression.

## Validation

`tests/test_content.py` checks catalog uniqueness, minimum variant counts, timing and snapshots, all single/pair priority combinations, six plan cycles and pool exhaustion. `tests/test_exercise_completion.py` covers advisory pace, optional transcription failures, removed live catalog entries, legacy timers and honest time accounting.


## Extra practice and take history

The first successful attempt retains the plan item's completion timestamp and `latest_attempt_id`. Additional practice requires explicit `practice_only=true` in the upload form and attempt JSON, and an already completed owned item. Completed items from archived plans are eligible through the API; locked/pending items cannot use this mode. Recording mode must match the upload. A passed recording can be used once; network retries must reuse their Idempotency-Key. Explicit false preserves the original request fingerprint for existing clients.

Extra attempts keep their own feedback, recording ID and timestamps. They award zero notes and do not mutate the saved plan, lesson status, completion date, streak or reassessment availability. A failed repeat leaves the exercise completed. Recorded duration from a genuinely new accepted take contributes to recorded-time totals once; untimed confirmations add no guessed duration. Additional attempts per local day are capped by the configured daily recording limit.

`GET /api/v1/exercise-attempts?plan_item_id=UUID&limit=20&cursor=…` lists owned-item attempts newest first with `next_cursor`. The exercise screen restores the latest result, allows earlier-take playback, loads more history, and explains that repeat practice is uncredited.


## Recoverable listening and revision loop

`GET /plan-items/{id}` resolves the issued task in its original owned plan, including archives. Completed-day rows and progress history link back to feedback/repeat practice. Pending archived tasks stay readable but cannot create ordinary completion attempts.

An accepted upload persists its check job pointer. The item endpoint returns the newest unsubmitted, undismissed take for the current completion/practice mode. The client resumes polling and saves that recording after reload; attempt/reward safeguards prevent duplicate credit. Polling and attempt errors expose retry controls. `PUT /recordings/{id}/dismiss` idempotently cancels recovery of an unfinished exercise take while retaining its audio. Worker publication preserves dismissal made during processing. Audio that has not reached the server is not recoverable.

`PUT /exercise-attempts/{id}/reflection` stores a trimmed subjective note (500 characters maximum). A repeat can reference `based_on_attempt_id`; upload snapshots the source note into `practice_focus`, which survives reload and later edits of the original note. The repeat result offers the previous private recording beside its own playback. Compatible timing feedback is shown side by side without claiming that a numerical change means improvement.

Catalog-v6 adds optional pause timing to E08; E06 already requests pace. Their feedback schema `speech-timing-feedback-v1` labels transcript-derived pace, pause share, a recognized word boundary and a playable audio interval, plus one small next step. It never scores pronunciation, emotion or expression. Other exercise types keep quality checks and listening/reflection prompts. Transcription unavailability remains advisory. The original timing loop is independent of the later background qualitative review described below.

Timing validates each word interval against the decoded duration and matches the word count to intervals, as well as checking finite, ordered, nonoverlapping timestamps. Invalid timing is unavailable, not a low score. Assessment measurement version is now `voice-metrics-v3`; previous versions and prepared demo baselines are not comparable to current real measurements. Check-in playback only returns pairs with actual recording IDs on both sides.


## Background speech coaching

A saved passed recording can queue `exercise_review` separately from its quality check and completion. `speech_review` on the attempt persists job ID, schema version, status, goal snapshot and eventual report. A missing provider configuration or exhausted per-guest/service daily budget records an unavailable reason; it never rejects the completed practice. Existing takes can request coaching through `POST /exercise-attempts/{id}/review`; failed jobs use bounded `/jobs/{id}/retry`. Owner/deletion/lease controls apply to this job as to other processing. Publication re-reads the attempt to preserve concurrent reflection edits. Queued recording quality checks take priority over waiting analysis jobs.

The provider receives the real audio, saved task, verified transcript, measured timing and the repeat's saved focus. It returns a concise summary, at most one audible observation, a contiguous transcript quote/occurrence, one comfortable next action, one listening question and uncertainty notes. The server resolves the quote into actual validated ASR intervals; it does not accept model-generated timestamps or objective skill scores. If transcript timing cannot support an anchor, coaching is unavailable. An absent quote is an invalid response. A quoted interval locates the phrase, but does not prove the model's perceptual judgment. The UI labels it as fallible AI listening notes and offers playback.

Tests validate real-audio request construction through mocked HTTP, strict schema rejection, worker publication, ownership, unchanged completion/reward/audio, daily budgets, provider failure/retry, grounding and concurrent reflection. They do not establish accuracy on human speech. A bounded synthetic-speech paid-provider probe is recorded in [evaluations](evaluations/README.md). Human usefulness evaluation remains outstanding.


## Shared check recovery and upload cancellation

`useRecordingCheck` handles saved job polling, retryable failed checks, checked-recording reuse after save failure and Blob/field-aware upload identity in both daily exercises and baseline/check-in. Assessment GET resolves a task's pending/last upload through the same owned recording-job resolver as plan-item state. Failed baseline checks remain discoverable after their pending pointer is cleared. The frontend retries the existing job rather than reuploading accepted audio.

An extra upload can be canceled by its original upload UUID before the acknowledgment arrives. Idempotent `PUT /recording-uploads/{upload_key}/cancellation` either dismisses the already accepted unsubmitted recording or stores a durable cancellation intent that blocks a later upload. Guest transaction locks serialize these outcomes. Successful cancellation cannot remove a saved attempt; canceled audio is retained privately and excluded from pending-take recovery. A network error is an unconfirmed cancellation, so late check completion cannot auto-save an attempt while cancellation is pending/retryable. History switching is disabled during extra practice; cancel or finish it first.

Check-in mic setup loads and displays previous conditions, including custom distances/unknown values/notes, then prefills the form without overwriting later edits. It shows actual device/setup differences. Recording displays its own saved conditions, and the Back link preserves check-in/demo context. New unfamiliar passages are described accurately instead of promising all three passages are repeated verbatim.


SQLite worker transactions acquire BEGIN IMMEDIATE before reading a claim or JSON resource that will be replaced. This gives API cancellation and worker publication the same serialization guarantee; PostgreSQL continues to lock owned guest/job rows. Durable upload-cancellation markers independently exclude the recording from pending lookup and attempt acceptance, including records where an older worker lost the dismissed flag.

Before sending cancellation, the browser stores the guest/item-scoped operation or recording ID. A restored intent suppresses the saved-check component and replays cancellation before any automatic attempt. Successful confirmation removes it; account deletion clears device cancellation state. Storage-disabled environments retain it only for the current page and show a concrete keep-page-open/retry message after a network failure. An unavailable local store cannot guarantee offline intent survival across reload.


## Focus transfer into narration

`POST /practice-focus` selects one owned passed recorded take, saves its trimmed reflection and creates an immutable `practice_focus` resource. It stores the user's chosen skill, one note, a versioned listening rubric, three comfortable practice steps and the source take/recording IDs. GET returns the active version, available skill rubrics and the latest subjective listening check for that version. It persists across local days; it does not claim mastery or independently change curriculum difficulty. Focus changes share the daily recording-count limit.

E12 item state exposes the active focus. The recorder freezes the version shown at recording start, even if another tab changes or clears it before upload. The client explicitly attaches `training_focus_id` only for narration; omitting it means no focus for that take. Upload recovery and the saved attempt retain the full snapshot. Changing the active pointer or source reflection cannot rewrite it. Deleting an older focus pointer cannot clear a newer active choice. The Today card brings the focus and latest listening check into the next session.

After playback, the user can save `heard`, `partly`, `not_yet` or `unsure` through the attempt's focus-check endpoint. The stored source is `user_listening`, never an AI/listener consensus or numerical score. It changes neither time/rewards nor completion/skill level. A repeat comparison labels differing focus versions. Background audio review receives the frozen note and semantic rubric, without source IDs or another take's audio; it cannot claim a before/after comparison.

## Partial word alignment

Real Whisper output can contain a zero-length internal word even with correct transcript text and positive first/last anchors. Finite, ordered, nonoverlapping intervals, exact recognized word count and decoded-audio bounds remain mandatory. Positive outer anchors at least one sample apart allow overall WPM; any zero-length word makes pause count/share/time and articulation rate unavailable (`word_alignment_incomplete`). No word boundary is invented. Zero-length edge words, tiny invalid spans, mismatched counts and out-of-audio timestamps remain unavailable.

Quote playback can widen to adjacent real positive word anchors when an internal/edge quoted word lacks a separate span. It returns the actual expanded phrase and an uncertainty note, rather than assigning that word a fabricated timestamp. Existing available metric values use the same voice-metrics-v3 calculation; this changes availability for formerly rejected partial alignments, not the numerical method for prior available results.

The coaching prompt is versioned (`exercise-coaching-v2`) separately from its JSON schema. It asks for an audible reason before changing a feature and allows preserving a useful feature in a new text. The real synthetic probe still produced a mechanical pause-lengthening suggestion, so prompt compliance and human usefulness remain unresolved. Automated quote grounding is a location check, not a correctness certificate.


## Assessment result and recovery

A failed full analysis is resumed through its saved job, not another submit/upload. Recording/profile routes reach that job; analysis can recover its ID from the assessment, accepts links containing either identifier, and shows actual server stages. A stale incomplete profile is refreshed before redirecting again so a completed job cannot cause a navigation loop while its report loads. Missing identifiers and failed polling have explicit retryable UI states.

Completed profiles show saved report/comparison limitations and private source playback, including the recorded script. The measurement-scope details identify which tasks supplied each numeric group. For assessment-v2, pitch/intonation range/pace/pauses use the first two reading tasks; the third expression task goes to the audio-model report only. Check-in labels the fresh unfamiliar text as different from its baseline passage. `assessment-coaching-v2` makes uncertainty notes user-facing and separates system policy from untrusted context/audio. This does not establish accurate auditory judgment.

The opt-in browser test-server fixture has empty paid credentials and a deterministic provider from tests/browser_provider.py. It deliberately fails each new full analysis once, then verifies same-job retry, report limitations, source playback, check-in comparison and plan navigation. Its ASR/report are synthetic fixtures; only transport, state transitions, real local audio processing and UI behavior are asserted.


Focus precedence for narration: the frozen `training_focus` note/rubric is the coaching intent even when a repeat also stores a different earlier `practice_focus` reflection. The source reflection remains historical comparison context. Source-category editing restores the saved manual category unless the user explicitly selects the exercise default. A late reflection/listening-check save updates its own take without changing the current history selection.

`targets-v2` changes pause-share wording, not numerical ranges or measurement methodology. A value in the practice band does not establish good semantic placement; the UI corrects old persisted labels as well. Playback remains the way to judge which thought a pause separates.


## Listening decisions and keeping a useful feature

A reflection can store intent=experiment, keep or undecided. These are subjective practice decisions, with no reward/skill implications. A note can be empty when the learner only wants to record a decision. Omitted or null intent in a legacy reflection PUT preserves the saved choice; choose undecided to defer a new action. The same note/choice returns the same timestamp.

New story-focus snapshots include intent and rubric version story-listening-v2. Keep uses steps to preserve a useful feature in a new phrase without automatically intensifying it. Experiment tests one optional change. POST inherits source intent when omitted, defaults to experiment for pre-intent data, and requires an explicit new choice if the source is undecided. Saving an undecided reflection does not implicitly clear or replace a separately saved focus; the UI explains that relationship and links to current focus management.

The editor offers native keyboard-operable radio choices and a user-authored note; it does not copy AI next_step through a shortcut. Failed saves retain the note/choice and retry identity. Choices and manual skill category restore after reload. Story focus freezes at recording start, normal same-item practice intent at accepted upload; later source edits do not rewrite those stored snapshots. Coaching receives practice_intent consistently with its frozen note, and prompt exercise-coaching-v3 allows retaining a feature or listening before deciding. No new paid quality evaluation has been performed, so model compliance/usefulness remains unproved.

Legacy POST focus receipts keep their exact original fingerprint and response shape when intent is absent. Old snapshots without an intent remain readable; they are not rewritten with an invented listener decision. Native completion remains independent of all these optional reflections.

Local timing feedback follows the same frozen intent precedence as AI context. Keep/undecided never require a different pause or an unrelated emphasis change; a pace within the suggested range can be retained. Local advice is optional, including corrected rendering of older saved next_step text. Repeat comparison describes the current story intention, not an older source reflection as if it governed the new take.
