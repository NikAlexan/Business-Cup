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
