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


## Iteration 7 independent review

Sol 6.1 Max reviewed immutable `4b27ef0`: overall **8.1/10** (content 8.0, feedback 7.8, backend 8.1, frontend 8.2, checks 8.4). It confirmed baseline recovery, saved-check retries, setup display and the qualitative-coaching architecture, while correctly distinguishing transcript location from perceptual accuracy. A controlled SQLite reproduction found a cancellation lost between the worker's fresh read and JSON publication because SQLite ignores FOR UPDATE. A second finding: an offline cancellation intent existed only in local refs and could be lost on reload. Cross-exercise/next-day focus transfer remained absent. The reviewer did not run full suites/browser or paid models.

## Iteration 8: cancellation is durable across worker publication and offline reload

- SQLite worker claim and every locked publication/state transaction now begin with BEGIN IMMEDIATE before the first read, matching API write serialization. PostgreSQL keeps its row-lock behavior. A threaded regression pauses publication immediately after its fresh read, proves an independent SQLite writer cannot enter that window, then interleaves the real API cancellation and verifies the flag survives.
- Pending-take lookup and attempt acceptance also consult the durable upload-cancellation marker. This protects previously canceled records even if an older worker already lost dismissed_at; a regression removes that JSON flag and still proves no recovery or attempt is allowed.
- Client cancellation intent is written before the network request, scoped by guest/item, with only operation/recording IDs. It is read synchronously before rendering the saved-check component after reload. A stored intent replays cancellation first and blocks job polling/automatic submission; transport failure exposes retry, not recording controls. Success removes the intent, account deletion clears device cancellation state, and storage events synchronize browser tabs.
- When persistent storage is unavailable, the current page retains the intent in memory; if confirmation also fails, the UI explicitly asks the user to keep the page open and retry. No persistence across reload is claimed in that unsupported-storage case.
- Added a mounted reload regression with a server-completed take and offline cancellation, plus a real Chromium scenario: accepted extra upload, cancellation request blocked before reaching server, reload, stored-intent retry, zero quality-job polls/attempts, eventual confirmed cancellation and unchanged notes/time.

Verification: 177 pytest tests pass, 59 Vitest tests and production build pass; Ruff lint/format/diff checks pass. All eight Chromium scenarios passed in the final full run, including offline cancellation/reload. Tests still do not establish human learning or paid audio-model accuracy.

The story-focus implementation started before this review was preserved separately while correcting cancellation; it remains the next product work, rather than replacing the original goal with reliability-only success.

## Iteration 9: transfer a chosen change into narration and the next day

- Added immutable owned practice-focus versions from an accepted recorded take, with one saved reflection, a user-selected/suggested skill, eight skill-specific listening rubrics, concrete practice steps and source playback. The Home card preserves the focus and latest subjective check into the next local day.
- E12 narration shows the focus before recording. The recorder freezes the shown version at start and explicitly attaches it during upload; another tab's edits/clearing cannot rewrite the take. Saved checks, recovery, attempts and history retain the snapshot. Deleting an old active pointer cannot clear a newer focus.
- After story playback, four listening outcomes are saved with source=user_listening. They do not award notes, add time, advance a level or claim mastery. Repeat comparisons label different story-focus versions. The separate audio review receives the frozen note/rubric, without private source IDs or unheard comparison audio.
- Added four API requests and examples; Postman now has 41 requests, 107 examples (103 JSON bodies). Documentation covers explicit upload attachment, ownership, idempotency, stale-delete behavior and subjective outcome semantics.
- A bounded real-provider diagnostic used public synthesized speech and four paid requests total (two ASR, two audio), with no automatic retries. It exposed an internal zero-length Whisper word that previously discarded otherwise usable overall pace. The fix retains bounded/verified pace while leaving pauses/articulation unavailable, and widens evidence playback only to real neighboring word anchors with an uncertainty note. Regression tests use the captured public ASR fixture.
- The first real audio response was grounded but gave mechanical pause-lengthening advice and a false transcript-only limitation. Versioned coaching instructions removed that false limitation in a second response, but did not establish useful advice: the second response again proposed lengthening without a concrete audible reason. Both raw results and this limitation are retained in evaluations/README.md. No further paid requests were made to seek a flattering result. Human usefulness, independent listener agreement and skill transfer remain unvalidated.

Verification: full backend 185 passed; provider prompt-specific suite then passed 16 tests after the versioned instruction update. Frontend 61 tests and production build passed; the strengthened mounted evidence-note regression also passed. All nine Chromium scenarios passed in the final full run against the real isolated API/worker with synthetic microphone input and empty paid credentials. The cached live-ASR diagnostic reproduced successfully with zero provider requests. Ruff lint/format, diff whitespace and all 103 Postman JSON response-body checks pass. The latest independent score remains 8.1 at 4b27ef0, not an assumed score for this work.

## Iteration 9 independent review

Sol 6.1 Max reviewed immutable 84e672e: overall 8.3/10 (content 8.2, learning/transfer 8.1, feedback/assessment trust 7.5, backend 8.9, React/recovery 8.2, checks/evidence 8.6). It confirmed durable SQLite/offline cancellation and start-time focus snapshots. Its API/worker reproduction found a repeated story can send the previous reflection instead of the frozen story focus to coaching. Mounted React checks found a manually chosen skill resets to Suggested after reload, and a late listening-check response selects a take the user has already left. It also identified misleading Well-placed pauses labels based only on pause share, and the risk of adopting unsupported AI next-step advice. Human usefulness/transfer and independent listener agreement remain unproved. The reviewer ran 134 existing pytest plus focused reproductions, sampled 48 catalog variants, read all live diagnostics and made zero paid calls; it did not rerun all browser/full-suite checks. These findings apply to 84e672e and are queued after the current assessment recovery work.

## Iteration 10: complete assessment recovery and inspectable reports

- Full-analysis failure now routes back to the saved analysis job from Record/Profile instead of offering another submit. An analysis URL containing only an assessment ID restores its job. Missing/mismatched identifiers and polling errors have explicit UI states; Retry uses the saved job and keeps accepted uploads intact.
- Analysis stages now follow the worker's actual stage instead of marking measurement complete based only on processing status. Completed-job navigation and incomplete-report refresh are separate: a delayed report fetch cannot repeatedly bounce between screens. A mounted controlled-delay regression covers that window.
- Completed profiles expose saved uncertainty notes, source recordings/scripts and numeric measurement scope. Check-in shows comparison limitations and labels unfamiliar passages as different texts. Corrected the API guide's stale claim about third-task numeric intonation: assessment-v2 numerics have intentionally used the first two readings; the third task contributes audio-model listening observations.
- Assessment prompt v2 puts instructions in the system message, treats context/audio as untrusted, makes limitations user-facing and forbids qualitative comparison with unheard baseline audio. Its version persists in analysis_metadata. Existing numerical methods/comparability gates remain unchanged.
- Added an explicit opt-in browser-only deterministic provider, requiring empty paid credentials and failing each new full analysis once. A real-API/worker browser journey records all baseline/check-in tasks, reloads the failure, retries the same job, checks report/source playback and reaches the new plan. Its ASR/report are test fixtures, not proof of paid-provider or human coaching accuracy.
- The initial new browser journey exposed a stale-cache navigation loop on check-in; a controlled mounted test isolated the extra invalidation, and navigation was corrected before final validation. No production data or paid calls were used.

Validation: full backend 185 passed; frontend 66 passed; production build, Ruff lint/format, whitespace checks and 103 Postman JSON examples passed. The full Chromium run passed the nine existing scenarios and reached the new scenario's completed check-in/new plan, then failed its final assertion because the test expected a nonexistent Day 1 heading. After correcting the locator to the actual Your plan / Session 1 of 14 UI, the isolated new full baseline/check-in scenario passed (six uploads, two submits, exactly two same-job retries). All ten distinct scenarios are verified; the final correction was test-only, not another application change. The last independent score remains 8.3 for 84e672e; this later work has not been separately rated.

## Iteration 11: consistent focus, stable take selection and descriptive pause labels

- Coaching now gives the frozen story-focus note precedence over the previous-take reflection, so the note and rubric refer to the same intended practice. Historical source reflection remains available for comparison; the UI identifies it as previous-take context when a separate story focus exists.
- The reflection editor restores a saved manually chosen skill for the active source take. Only an explicit Suggested selection reverts to the exercise default. User edits are not overwritten by the asynchronous initial focus fetch.
- Listening-check and reflection callbacks update the addressed take cache, but replace the visible result only while that same take/item is still selected. Switching history or starting another recording invalidates that view identity immediately. Late saves are kept without returning the user to the old take.
- targets-v2 keeps the existing numerical ranges and replaces pause labels with descriptions of time share. The frontend also corrects legacy persisted labels, rather than continuing to display Well-placed pauses from an old profile. An explicit note distinguishes duration from semantic placement. Measurement version/comparability are unchanged because no numerical method changed.
- Added an API/worker regression with conflicting old/new focus notes, mounted reload/category/default coverage, late-response history selection checks for both listening outcome and reflection, and legacy-profile rendering coverage. The real-browser focus journey now includes an extra story take and delayed listening-check response while selecting the original take.

Validation: full backend 186 passed; all 70 frontend tests, production build, Ruff lint/format, whitespace checks and 103 Postman JSON response checks passed. A new-test selector option was rejected by TypeScript and removed before the successful final build/browser run. The strengthened targeted Chromium journey passed: chosen focus, extra story, delayed listening-check response, stable original-take selection and retained result for the extra take. The unsupported-AI-advice adoption finding remains open: retaining a useful feature and declining a change need explicit product support, followed by human listening evidence; these state fixes do not validate coaching quality. Next: implement a recoverable, optional listening decision before adopting AI next_step, with separate choices to experiment, keep a useful feature or leave a change undecided. Preserve user-authored reflection and normal completion throughout.

## Iteration 12: listening decisions instead of automatic AI-advice adoption

- Added optional user listening intention to reflections: experiment, keep or undecided. Native radio controls and a user-authored note replace the direct Use suggested change shortcut; AI ideas remain visible alongside private playback and are labeled optional. Normal completion/repeat controls do not depend on a reflection.
- Keep creates a story focus with explicit steps to carry a useful feature into a new phrase without automatically making it stronger. Undecided can be saved with an empty note and does not adopt a new focus; the UI explains that an existing separately saved focus remains until explicitly replaced/cleared. The next-session card, story goal and listening question distinguish keeping a feature from trying a change.
- Story snapshots now preserve intention with rubric story-listening-v2. Same-item repeat snapshots include it at accepted upload. Later source edits cannot rewrite either stored snapshot. Coaching receives practice_intent in agreement with the chosen frozen note; exercise-coaching-v3 includes retaining/listening-first instructions. Model compliance has not been verified with another paid call.
- Legacy omission/null preserves a reflection's existing choice. An explicit undecided source cannot silently become a new story experiment; focus POST requires a new experiment/keep choice in that case. Old focus POST fingerprints and idempotency receipts still replay exactly without intent, including a fixture from the prior contract. Existing snapshots remain readable without inventing a historical listener decision.
- Added ownership/idempotency/legacy receipt, source-intent inheritance, frozen keep/experiment context and same-item repeat regressions. Mounted frontend checks cover retaining a useful feature despite a contradictory AI idea, failed-save note/choice/key preservation, reload, and an empty undecided reflection without replacing the existing focus. The real-browser focus/extra-take/late-response scenario now carries keep through narration and the Today card.
- Updated API documentation and Postman to 41 requests, 109 examples, 105 JSON response bodies. Retained all prior raw live-provider diagnostics and their weak-advice findings. This resolves the missing product alternatives, not the remaining need for useful judgments on varied human recordings and independent listener agreement.

Verification: full backend191, frontend72 and production build pass. After clarifying null-as-omission behavior, the two targeted compatibility/legacy-receipt regressions passed again. All ten Chromium scenarios passed in the final full run, including keep/extra-take/history and full baseline/check-in recovery. Ruff lint/format, diff whitespace and all105 Postman JSON bodies pass. No paid API calls in this iteration. Next after commit: independent Max re-review of the combined assessment and learning-loop changes. Then add clearly labeled audible practice contrasts and an evaluation protocol, while keeping synthetic integration evidence separate from human usefulness evidence.

## Iteration 12 independent review

Sol6.1 Max reviewed immutable78abf24: overall8.6/10 (content8.2, feedback/autonomy8.0, backend8.9, React/recovery8.5, assessment8.7, engineering evidence8.8). It confirmed closure of the earlier five findings and usable keep/undecided alternatives, ownership and legacy-receipt compatibility. Two narrower contradictions remained: repeat comparison read old practice_focus.intent instead of current training_focus.intent, and deterministic timing advice ignored the chosen intention and still used Try next. It also noted absent audible demonstrations and that the diagnostic CLI had not yet passed practice_intent/current rubric. It ran28 offline cases plus in-memory API/schema checks, without upload/worker/browser/network/paid calls. Its score does not certify human coaching accuracy or transfer.

## Iteration 13: consistent optional advice in every feedback path

- Repeat comparison uses the current story-focus object before older reflection context, matching worker precedence, so a previous keep decision cannot be attributed to a new experiment take.
- The quality worker passes the recording's frozen intention into local timing feedback. Keep supports carrying the feature without automatic intensification; undecided supports listening before deciding. A within-band pace no longer generates an unrelated emphasis correction. Recorded measurements remain descriptive and completion stays independent.
- The UI presents local timing advice as Optional practice idea and respects current keep/undecided for legacy saved feedback too; it does not require reprocessing old audio to remove a contradictory suggestion.
- The diagnostic CLI now accepts explicit --intent for experiment/keep/undecided, passes it to provider context and uses current rubric metadata. An updated cached-ASR keep diagnostic completed with0provider requests. Historical paid v1/v2 raw responses remain untouched; the current prompt has not received a new paid quality validation.

Verification:21 targeted backend coaching/focus tests passed, including4 real quality-worker repeat cases with frozen keep/undecided and later source edits. Frontend74 and production build passed, including conflicting previous/current intentions and legacy local-advice rendering. Ruff/diff checks pass. The prior full191/72/10-browser evidence belongs to78abf24, not this later targeted run. No new paid calls. Audio comparison preparation verified local Flite exports and native word timings against primary API/voice licensing sources; assets and the connected listening task remain next work.

## Iteration 14: audible pause contrast carried into a real take

- Added an optional E08 listening lab: two original, clearly labeled synthetic clips use identical speech samples and equal inserted silence, at different native word boundaries. The question concerns keeping a phrase together; no score or target voice is assigned. Text patterns, audio retry and credits remain available, and normal practice can skip the lab.
- Added a local reproducible generator, immutable versioned manifest, content-addressed WAVs and retained Flite attribution. Re-running the generator reproduced the same hashes without network/provider calls. Backend tests remove the declared silence and independently prove the remaining PCM is identical. No private/human recording was used for public examples.
- An explicit owned listening-plan POST snapshots the selected boundary from the already assigned text, the listener's unscored A/B/unsure choice and the example version. Starting recording freezes that exact ID. A later choice in another tab, a changed default reference or reload cannot attach a new boundary to an unseen take. Omission preserves legacy behavior. Preparation adds no completion, notes or practice seconds.
- Saved suitable takes optionally locate the chosen boundary using validated transcript timing and a unique local phrase. Feedback describes the gap between recognized words, gives private evidence playback and explicitly does not judge semantic placement. Missing/ambiguous context, selected-word zero/subsample timing, invalid bounds or ASR failure yield unavailable while retaining accepted practice. Numeric assessment methods and measurement versions are unchanged.
- One player pauses another, including a removed buffered element; recording pauses audio synchronously before microphone permission, and navigation stops playback. Stop remains available during other pending work. Public examples are explicitly precached; private audio/API stays uncached. Missing public WAVs return 404 rather than the SPA document.
- Added ownership/idempotency/uncredited preparation, immutable upload/recovery/attempt context, catalog-change, Unicode apostrophe, timestamp uncertainty and provider-failure regressions. Mounted UI tests cover retry identity, text fallback, frozen start-time selection, restored evidence, exclusive playback and Stop. The real-browser scenario uses actual public WAVs, a synthetic microphone, real queue/VAD and the explicitly deterministic test provider; it does not establish human learning or AI accuracy.
- The first new Chromium run exposed a real CSS issue: the general stack display rule overrode the HTML hidden attribute and left reference controls visible during recording. Explicit display state fixed it; the isolated complete scenario then passed. A test recorder stub's unstable Blob initially caused a test-only render loop and was made stable before the passing frontend run.
- Added the API contract and Postman request/examples (42 requests,112 examples,108 JSON response bodies), and a documented independent human-listening/transfer protocol. The protocol is prepared, not executed. There have been no new paid API calls, no human-study results and no new quality-score claim. Last independent score remains8.6 for78abf24.

Validation: backend209 and frontend79 passed; production build, Ruff lint/format, whitespace checks and all108 Postman JSON response bodies passed. The complete11-scenario Chromium run passed, including baseline/check-in and comparison→boundary→recording→reload→private-evidence. A final small editor change clears already-saved draft overrides so a later saved selection is shown correctly; the mounted retry test now checks this cross-tab update and all79 frontend tests pass again. The final rebuild and focused listening-browser check also passed after that editor change. No paid calls or human-evaluation claims.

## Iteration 15: preview closed sessions before asking for a recording

A direct link to an unfinished item in a locked lesson previously displayed recording controls, even though the server rejected the upload with lesson_locked. The exercise screen now shows a readable task preview, explains ordered sessions/the local-day rule, links to Today and offers an explicit availability refresh. Inactive unfinished archive items retain their reference-only explanation. Completed items still expose saved feedback and extra practice, including archived items with a locked lesson status. No backend access rule, daily limit or recording/reward behavior changed.

Verification: all81 frontend tests and production build pass. New mounted scenarios cover locked preview→availability refresh→recording controls without an automatic POST, unfinished archive preview and completed-archive extra practice. The strengthened completed-session Chromium journey passed against the real API: a future locked recording task remains a preview after refresh, then the available session can be completed and its saved exercise reopened for extra practice. The prior209 backend/11 full Chromium evidence belongs to iteration14; backend was unchanged here, and only the affected browser journey was rerun. No paid calls. The independent Max review still targets immutable6149d14, before this UI correction; do not attribute a future review score to it.

## Iteration 14 independent review

Sol6.1 Max reviewed immutable6149d14: overall8.7/10 (content/demonstrations8.4, pedagogy/autonomy8.4, backend9.0, React/recovery8.3, assessment uncertainty8.7, engineering evidence8.9). It confirmed the two earlier intention/advice findings closed, validated equal PCM contrasts, checked86 authored E08 boundaries, and found no public/private caching leak in its tested ASGI scope. It ran34 existing+2 extra API checks and40 existing Vitest; two additional mounted regressions exposed pending-take discovery after mount and stale idempotency-receipt selection. Full209/79/11-browser checks remain parent-provided. It made0 external/paid calls. The two P2 state errors are next fixes; the independent listening/transfer pilot remains unperformed.

## Iteration 16: reproducible public human-speech diagnostics

Prepared a pinned tiny CMU ARCTIC corpus with two original human readers, official source URLs, exact hashes/byte limits, automatic corpus timing and retained source license. Added explicit optional download/verification, human-case support in the bounded live diagnostic and a separate offline ASR/quality diagnostic. Original recordings stay in ignored model storage, not public product assets or guest data. An artificial article split is declared with its inserted silence and de-click edit, distinct from an original learner performance. The four offline cases cover three waveforms; keep/undecided reuse the same original.

The local live-highlighting recognizer matched this phrase exactly for both voices and the edited case, and VAD/audio quality accepted all cases. This is evidence for that narrow local path, not assessment Whisper, audio-model coaching, independent listening agreement or human learning. No new paid calls were made. Live human-case support is prepared but unexecuted; historical weak synthetic responses are retained. Current Max findings take priority before optional live probing.
