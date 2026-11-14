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
- Full backend rerun is in progress after installing the pinned streaming ASR dependency and checksum-verified models. Initial run exposed one obsolete pace-gate assertion (updated) and the missing local ASR installation.
- Node 24 was installed outside the repository for local tooling. No secrets or downloaded models are committed.
