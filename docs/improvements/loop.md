# Product improvement loop

Work branch: `improve/speech-training-loop`. No PR until the user requests one.

## Acceptance criteria

- Speech takes end when the user finishes; recommended pace/duration are coaching, not exact completion gates.
- Separate spoken script, action instructions, expected practice time, and technical upload limits.
- At least 20 meaningful variants for each exercise type, with rotation within/across 14-day plans.
- Content targets articulation, clarity, pace, pauses, intonation, expression, breath phrasing and narration.
- Measured feedback must distinguish audio quality from pronunciation/expression assessment.
- Backend and frontend checks pass; periodic independent gpt-6.1-sol with reasoningEffort=max reviews score separate aspects /10. Target 9.5 is an aspiration, not a claimed outcome.

## Iteration 1: completion gates

- New articulation warm-ups use repetitions and self confirmation rather than a 45-second wait.
- Legacy timers are advisory; actual elapsed time is preserved.
- Pace outside the recommended band and unavailable pace produce coaching, without rejecting usable audio.
- UI shows saved task instructions instead of replacing them with current catalog instructions.
- Successful takes explain the scope of the audio quality check and show pace coaching.
- A failed recording job releases the send controls and retains its error so the user can resubmit.
- A microphone granted after a permission timeout is immediately released; playback animation stops on component unmount.
- Added frontend regressions for late and timely microphone permission.
- Added API regressions for below-target/in-target/unavailable pace and legacy timers.

## Next work

1. Author at least 20 substantive variants per type; avoid cosmetic substitutions and instruction text inside spoken passages.
2. Replace the two-entry difficulty indexing with stable variant identity, difficulty and rotation.
3. Calculate duration estimates from text and repetitions; use a separate generous technical recording limit.
4. Persist required metrics and checks with each plan item, so archived plans do not depend on a mutable catalog.
5. Expand evidence-based exercise feedback and enable useful listening/reflection after each take.
6. Test browser journeys, mobile layout and retry/reload paths.

## Content rationale

These are original speaking practice materials, not validated therapy protocols. Preserve comfortable volume and pitch, avoid breath holding, force and pain.

- NIDCD, Taking Care of Your Voice: https://www.nidcd.nih.gov/health/taking-care-your-voice
- Toastmasters, Vocal Variety and Body Language: https://ccdn.toastmasters.org/medias/files/pathways/2021-updates/8104-vocal-variety-and-body-language.pdf
- Stanford, Delivery: https://octresources.stanford.edu/presentation-and-delivery/delivery

The sources support the practice categories and general vocal comfort, not a claim that a generated drill produces clinical improvement.

## Verification checkpoint

- Frontend: 22 Vitest tests pass; TypeScript and Vite/PWA production build pass.
- Backend: four new exercise-completion regression tests pass; Ruff lint/format pass.
- Full backend suite: 46 tests pass after installing the pinned streaming ASR dependency and checksum-verified models. Initial run exposed one obsolete pace-gate assertion (updated) and the missing local ASR installation.
- Node 24 was installed outside the repository for local tooling. No secrets or downloaded models are committed.


## Independent baseline review

Sol 6.1, max reasoning, reviewed `e9fe30e` read-only. Overall readiness: 5.5/10; content was the largest weakness. No browser verification or new test runs were claimed by the reviewer. Findings: weak catalog and repeated plans; estimated time credited as actual; optional transcription failures blocking accepted takes; pending mic permission outliving its page; feedback lost after reload; mutable catalog requirements; auto-stop boundary mismatch; incomparable baseline interpretation. These are tracked as implementation work, not hidden behind passing unit tests.

## Iteration 2: content, rotation, honest time and resilient feedback

- Authored 240 distinct variants across all 12 types, with independent difficulty/identity, explicit repetitions, substantive narrator/pace paragraphs, and skill-specific listening prompts.
- Saved complete schema-2 task snapshots, including metric requirements and quality rules; added least-used variant rotation across plans.
- Derived estimated session duration from the actual chosen scripts, repetitions and listening. Technical limits are independent and generous. New sessions target 5–8 estimated minutes.
- Untimed self-confirmations no longer create fictitious actual seconds; legacy estimated self-confirmations are also excluded from totals.
- Optional exercise transcription failures preserve accepted audio and unavailable metrics. Full assessment failures remain explicit.
- UI shows variant name, suggested take range, reflection, full repeated script, saved feedback after reload and measured pace when available. Checked takes remain available after an attempt transport error.
- Remaining next priorities: cancellable mic lifecycle; recording auto-stop margin; optional repeat without duplicate rewards; full frontend interaction/browser tests; comparable check-in baseline; richer evidence-based feedback beyond the quality check.


Iteration 2 checks: 90 tests passed in the full backend run; the subsequently added historical-time regression also passed in the targeted 49-test content/completion run. Frontend: 23 tests, TypeScript and Vite/PWA production build passed. Ruff lint/format and diff whitespace checks passed. No live browser result is claimed for this iteration.


## Iteration 2 independent review

Sol 6.1 Max reviewed `f2e04a6`: overall 6.6/10. Content had real improvements, independently sampled across all types and all narration variants. Reviewer executed 222 plans / 3108 lessons and found estimates 300–369 seconds. Remaining objections: malformed transcription timestamps can still break optional metrics; the result loses the audio player; curriculum overuses a fixed complementary skill and resets difficulty; a vowel prompt still contains an instruction and some reflections do not match the variant. This is a static/code review score, not a new score for later changes.

## Iteration 3: recording lifecycle and real user flows

- Integrated upstream dark theme and demo data into the improvement branch, preserving honest time labels.
- Added cancellable permission requests, a requesting state, protection against parallel starts, and cleanup on unmount/constructor/meter/recorder/socket errors. A canceled permission grant cannot start a new recorder after navigation.
- Auto-stop leaves encoder/timer headroom and explains that a technical limit ended the take. This does not impose a pedagogical timer.
- Completed exercise feedback now includes private audio playback, restored after reload.
- Added keyboard arrow/Home/End navigation with a single tab stop for onboarding goal selection.
- Interpretation and comparison now share one condition/protocol/measurement comparability gate.
- Invalid/missing/zero-duration/nonfinite/overlapping word timestamps become unavailable metrics. They do not invalidate accepted daily audio.
- Edited vowel-specific reflection questions and moved the remaining spoken instruction into instruction metadata; content version advanced to catalog-v4/E02 version4.
- Added frontend CI and browser CI.
- Verified 99 backend tests in the full run; 48 audio/content checks after the final comparison/content edits. Frontend: 38 tests and production build. Three Chromium E2E scenarios passed with the real FastAPI API, a real worker/VAD, temporary SQLite/audio and synthetic microphone audio: keyboard onboarding; 390px recording → feedback → private playback → reload with unchanged rewards/time; permission cancellation followed by eventual live-track release. The full paid initial assessment is not exercised by these browser tests.

## Next iteration priorities

1. Give explicitly recommended skills enough sessions; rotate complementary skills and maintain prior practice level instead of unconditional beginner resets.
2. Allow optional uncredited practice repeats and retain their feedback/history without duplicating completion, streak or notes.
3. Extend daily feedback beyond the basic quality check with useful, clearly sourced observations and reflection.
4. Expand real browser journeys to full sessions, retries/network loss, settings/history and multiple viewport/theme states.
5. Request another Max review after these product changes and browser evidence are available. Do not claim 9.5 without independent evidence.

## Iteration 4: personalized sessions and repeatable practice

- Catalog-v5 has 288 original variants: 24 per type, including 14 intermediate variants so experienced users can practice a full plan without repeating one variant inside it. Articulation now maps to appropriate vowel/consonant/word-ending work, not just a warm-up.
- Explicitly recommended skills anchor each day. A pace recommendation for E06 appears daily; complementary skills rotate rather than always inserting E11 first. Two priorities are each represented in a session.
- Completed intermediate practice is retained in later plans for that exercise. Unpracticed scheduled tasks do not imply experience. Levels describe the practice, not proven vocal mastery. Selection avoids repeats inside a plan before balancing historical usage. Vowel time estimates include all requested rounds.
- Added explicit `practice_only` uploads/attempts for already completed owned exercises, including archived plan items. Extra practice never mutates the original plan/lesson/completion timestamp or grants notes. A rejected extra take leaves completion intact.
- Unique accepted repeat recordings contribute recorded seconds once. Reusing an accepted recording with another key is rejected; same-key retries replay safely. Untimed extra confirmations still have unknown time and add no invented seconds. Extra attempts share the configured daily recording limit.
- Added owned-item cursor-paginated take history and UI selection/playback. Latest repeat feedback survives reload; original takes remain available. Canceling a repeat preserves completed feedback.
- Fixed upload key identity for Blob variables: the same Blob after a transport failure retains its key, but a new take gets a new operation key even with the same size/MIME. Explicit operation reset clears a failed key. Explicit false practice mode preserves old server fingerprints across deploys.
- Fixed the baseline recorder's Retry path to start job polling; failed checks preserve the captured take. Missing account/limit responses now show a retryable error rather than silent missing controls or an unsupported-browser message.
- Updated Postman with extra upload/save/history requests and current reward/time fields; removed the obsolete short-timer failure example. The collection has 32 requests and 88 examples (85 JSON bodies, with private audio/no-content examples separate).

Iteration 4 verification: full backend run 147 passed; Ruff lint/format and diff whitespace checks passed. Frontend 43 tests and TypeScript/Vite/PWA build passed. Fresh Chromium tests passed against the isolated real API/worker: the mobile scenario now also records extra practice, verifies unchanged notes and increased recorded time, reloads its feedback, then selects and plays the original take. Browser checks still do not exercise a paid qualitative voice analysis.

Next: independent Max review of the current product, then strengthen useful daily feedback beyond audio-quality confirmation and optional pace; extend real user journeys to full-session completion and error/recovery cases. Target 9.5 remains unproven.


## Iteration 4 independent review

Sol 6.1 Max reviewed immutable `94da7e1`: overall **7.4/10** (content 8.0, feedback 6.5, backend 8.0, frontend 7.2, checks 8.0). The reviewer found completion/repeat bookkeeping improved but identified unreachable repeats after a closed day, current-plan-only item lookup, lost upload recovery after reload, limited learning feedback, out-of-audio timestamps, unmarked prepared history and missing check-in paired playback. The reviewer did not run full suites or a live browser and did not claim paid analysis quality or human efficacy.

## Iteration 5: recoverable listening and revision

- Added owned original-item state across active/archived plans and persisted recording-check job pointers. The client restores an accepted upload and resumes check/save after reload without uploading again. Pending audio survives polling and attempt transport errors. A dismissal endpoint cancels unfinished extra-take recovery, retains audio and survives concurrent worker publication.
- Completed-day Today rows and progress recording history now reach the exercise's feedback/repeat flow. Pending archived tasks remain reference-only; completed archived tasks support extra practice.
- Added saved, owned, idempotent listening reflections (500 characters). Extra uploads snapshot the source take and note; source edits cannot rewrite the later take's practice focus. Reload restores it. Repeat results offer previous playback and a side-by-side table only for compatible available timing feedback.
- Catalog-v6 E08 adds optional pause timing alongside E06 pace. Validated transcript timings produce labeled measured observations, one recognized word-boundary evidence clip and one next step. Evidence playback seeks the private audio. These do not claim qualitative diction/expression scoring. Other exercise types retain quality checks plus their authored listening prompts.
- Validate timestamp bounds against decoded duration and ensure word count matches intervals; invalid timing remains unavailable and never blocks suitable daily audio. Numeric spoken words now count consistently. Advanced assessment measurements to voice-metrics-v3 to avoid comparing changed timing methodology to older values.
- Persistent prepared-history notices now appear across Today/Progress and exercise flows. Prepared demo baseline metrics cannot produce numerical comparisons with real audio. Check-in Profile shows matched before/after recordings; the server omits nonexistent pairs.
- Updated API guide and Postman recovery/reflection/dismissal examples: 35 requests, 94 examples, 91 JSON bodies. Corrected obsolete collection text claiming the backend was unimplemented.

Iteration 5 verification: 51 Vitest tests and TypeScript/Vite/PWA build passed. Five Chromium E2E scenarios passed against the isolated real API/worker with synthetic mic audio: onboarding; mobile feedback/reflection/repeat/source playback/reload; pending microphone cancellation; accepted-upload reload with polling loss and exactly one saved attempt/reward; full session completion followed by normal navigation back to review and extra-practice controls. These do not verify paid qualitative coaching or human skill improvement. Final full backend run: 159 passed, including E06/E08 worker-to-attempt publication regressions, upload recovery, immutable focus snapshots and timestamp bounds. Ruff lint/format and diff whitespace checks passed. A retryable recovered worker job can also restart its saved check without uploading again; the mounted frontend test covers that path.

Next: independent Max review of this complete pace/pause listening loop, then address its highest-value objections. Full qualitative daily audio coaching, trustworthy progression evidence and real human practice outcomes remain product limitations. The 9.5 target is not yet substantiated.


## Iteration 5 independent review

Sol 6.1 Max reviewed immutable `808df44`: overall **7.9/10** (content 8.0, feedback 7.3, backend 8.3, frontend 7.8, checks 8.2). The reviewer confirmed the prior main recovery/navigation/reflection/demo/timestamp fixes. Read-only in-memory React reproductions found two further defects: baseline/check-in still loses check recovery and retries by reupload; cancel during an in-flight extra upload can leave a late accepted pending take that later auto-saves. The check-in setup also fails to display its prior recording conditions. Qualitative feedback outside pace/pauses and useful skill transfer remain the largest product gaps. These findings refer to that commit, before the following implementation.

## Iteration 6: separate background speech coaching

- Added optional automatic `exercise_review` jobs after saving an accepted recording; original audio acceptance, completion, notes and recorded seconds do not depend on review success. Default provider configuration comes from the existing audio-model integration. Missing configuration and exhausted guest/service budgets are explicit unavailable states.
- Strict `exercise-review-v1` output has a short summary, at most one observation, one next action, one listening question and user-facing limitations. The provider receives real audio plus the saved task, validated transcript/timing, goal snapshot and the repeat's frozen focus. It does not receive a previous recording and is instructed not to invent a comparison or skill scores.
- Model-selected contiguous quote and occurrence are resolved against actual validated ASR word intervals; arbitrary model timestamps are never accepted. Invalid timing prevents publication of a qualitative observation; absent quoted words invalidate the result. The playback anchor locates a real transcript phrase but does not establish perceptual correctness of the model's interpretation.
- Review state/job/result persist on the attempt; results load after reload and refresh after terminal job state. Failed retryable jobs reuse the saved recording and bounded retry endpoint. Publication preserves reflection edits made during analysis. The UI labels fallible AI listening notes, offers evidence playback and retains reflection/repeat controls after failure.
- New POST attempt-review endpoint can request work for an older/unavailable accepted take; existing in-flight, completed or failed jobs are not duplicated. Daily per-guest and persistent global job budgets bound automatic analysis; they are not dollar caps and each job may make transcription/audio calls within bounded retries. Waiting quality checks take priority over waiting analysis jobs; running jobs are not preempted.
- API documentation, settings example and Postman updated: 36 requests / 97 examples. Actual audio API payload construction and schema failures are tested with HTTP transport stubs. No paid calls or live human coaching-quality evaluation were performed.

Validation: final full backend run passed 171 tests, including the new quality-priority regression. The provider payload was then strengthened to separate system instructions from untrusted user/audio context; its targeted provider suite passed. Frontend 53 tests and production build passed; five Chromium real-API/worker scenarios passed again with empty paid credentials (they exercise saved practice, not qualitative-provider accuracy). Ruff lint/format, diff whitespace and Postman JSON checks passed. These results do not establish paid-model or human-practice efficacy.

Next priorities from Max: baseline/check-in accepted-upload recovery with real saved-check retries; cancellation during delayed upload; show previous setup before check-in. After those, test transfer of a chosen focus into narration and preserve a clear next-practice goal. The current code does not establish real human improvement or a 9.5 product score.


## Iteration 7: assessment recovery, reliable cancellation and repeatable setup

- Extracted shared `useRecordingCheck` for daily exercise and assessment upload identity, polling errors, saved-job recovery, bounded job retries and checked-take reuse. Upload fingerprints now include task fields as well as Blob identity. Both screens keep the accepted file on the server and retry a failed check without a new upload.
- Assessment GET exposes each task's owned `pending_take`; a failed recording check stays discoverable via last_upload_id after pending_recording_id is cleared. Legacy recordings without a job pointer resolve through the owned quality job. The same resolver serves daily item state. Accepted/rejected quality advances through normal task metadata.
- Added idempotent upload cancellation by the original upload UUID, including before an upload acknowledgment. Guest transaction serialization either dismisses the unsubmitted accepted take or stores a durable marker rejecting a later upload with upload_canceled. Cancellation cannot remove an already saved attempt. Unbound cancellation markers have a daily guest limit. Recordings remain private; cancellation is distinct from account/audio deletion.
- Daily UI captures the operation key before upload starts, keeps late check results from auto-saving after cancellation intent, retries cancellation errors without unlocking new recording, and disables history switching while extra practice is active. Successful cancellation survives reload even when the original upload acknowledgment arrives late.
- Check-in setup loads the previous completed assessment and shows/prefills its device reference, distance (including custom/unknown), room and notes. It does not overwrite later edits on refetch. Actual setup differences are visible. The recording screen shows its own saved setup, and Back preserves check-in/demo context. Check-in wording now correctly explains the repeated control/expression tasks plus a fresh unfamiliar passage.
- Updated API docs/Postman: 37 requests, 100 examples, 97 JSON bodies, and upload-key capture before upload. Added a recovery example to assessment GET.

Verification: full backend run passed 175 tests; 58 frontend tests passed for the shared paths, including saved baseline polling/retry, delayed upload/cancel success and error, and prior setup submission. TypeScript/Vite/PWA build and Ruff lint/format/diff checks passed. Six of seven initial Chromium scenarios passed; the new baseline scenario correctly rejected its four-second fixture because baseline quality requires five seconds of audible speech. Increasing that fixture to nine seconds produced a passing three-task recording/reload scenario, without changing production quality rules. The final full Chromium run then passed all seven scenarios, including the three-task baseline recovery and delayed-upload cancellation. Tests still use synthetic audio and empty paid credentials; they do not verify a full paid profile/check-in report or human speech improvement.

Next: independent Max review of the combined background-coaching and assessment-recovery work; strengthen the learning loop by transferring a chosen focus into narration and tomorrow's practice. The last independent score remains 7.9 at 808df44; later code has not inherited a higher score by assumption.
