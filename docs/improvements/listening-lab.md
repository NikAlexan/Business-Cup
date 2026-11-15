# Pause listening lab

E08 offers an optional, audible contrast before recording. A listener can select A, B or Not sure, read the explanation, and choose one marked boundary in the assigned passage. Saving creates an unscored preparation snapshot. Skipping the comparison and recording normally remains possible; audio-load failures have text pause patterns and retry.

The first example uses the original sentence “At the old bridge the path turns toward the river.” A inserts 700 ms after bridge; B inserts the same silence after the first the. Both contain identical synthesized speech samples, including identical short de-click fades, and equal edge padding. The structural question is which keeps “the old bridge” together; the interface does not mark the listener right/wrong or assert that one voice is a universal model. Position is the teaching contrast, not a target duration.

## Reproduce and inspect

Run `.venv/bin/python scripts-generate-listening-examples.py` from the repository root. This developer tool uses installed `libflite.so.1` and `libflite_cmu_us_slt.so.1` through their C API, numpy and soundfile. It synthesizes the entire original sentence once, reads native Word relation endpoints and copies the waveform before freeing the utterance. No paid API, ASR, settings, private recordings or network access is used. It is not a runtime dependency of the deployed application.

The committed v1 used libflite1 2.2-6build3. The manifest at `app/content/listening-examples.json` records the exact version, word indexes, inserted-silence sample ranges, base PCM hash, output hashes and durations. The generated pair is 16 kHz mono PCM16, 3.77 seconds per clip, about 118 KiB each. The test removes the declared insertion from both clips and independently checks identical remaining PCM and the base hash. Regeneration on the current environment produced identical hashes. A different voice/library build may differ; the tool refuses to overwrite an existing example version. Use a new `--version vN`, retain old assets/manifests and inspect the contrast before making it the default.

`frontend/public/practice-examples/NOTICE.txt` preserves the upstream Flite attribution/license and identifies the original authored sentence and silence edit. Upstream references: [Flite COPYING](https://github.com/festvox/flite/blob/master/COPYING) and [cmu_us_slt voice source](https://github.com/festvox/flite/blob/master/lang/cmu_us_slt/cmu_us_slt.c). No user's voice or uploaded recording is present in these public files.

## Carry the choice into a take

The client saves an owned `listening_plan` explicitly and freezes its ID when microphone recording starts. A later choice in another tab is for a future take. Upload, pending recovery and saved attempt preserve the full old example/selected phrase snapshot. The API does not silently attach a newer choice to a recording that never displayed it. Listening choices do not complete an exercise, grant notes or add practice seconds.

After a suitable take, optional ASR timing locates a unique six-word local context around the selected boundary. Curly apostrophes are normalized locally; global assessment tokenization/numerical versions remain unchanged. Missing/mismatched context, ambiguous authored phrases, invalid/out-of-audio or unsupported selected-word timestamps, and provider failures leave the timing unavailable while preserving accepted practice. First reliable occurrence is used when there are repeated passes; pass number is not inferred. A descriptive gap and private playback cue are persisted with the attempt and restored after reload. Neither gap length nor the exercise's global pause ratio judges semantic placement. The learner listens and can keep what works, experiment only for an audible reason, or remain undecided.

Reference examples stop before microphone permission is requested. Starting another player pauses the previous player, including buffered players removed from the DOM; navigation stops playback. Stop recording remains usable while starting/sending other work is disabled. The service worker includes only the two explicit public WAV examples and credits alongside the app shell. Private API/audio remains uncached. Missing public assets return 404 instead of the SPA page; production WAV URLs are content-addressed and immutable, while credits can refresh.

## What the checks do and do not establish

Backend regressions cover exact waveform contrast, timestamp/context uncertainty, ownership, idempotency, unchanged curriculum/rewards, immutable take snapshots, legacy omission and provider failure. Mounted frontend checks cover text fallback, failed-save retry identity, start-time freezing, restored playback cues and exclusive audio/Stop behavior. A Chromium journey uses actual public WAV playback, a synthetic microphone, real upload/queue/audio checks and a deterministic test-only transcript/report. It confirms transport, state and interaction, not human speech assessment or learning.

Still unvalidated: naturalness of the contrast, independent listener agreement, usefulness on human speech, ASR alignment on varied accents, transfer to an unfamiliar story, and Safari. No human-study result or new paid coaching result is claimed.

## Independent listening and transfer protocol

Use consenting volunteers and recordings they authorize for the study; do not publish their voices by default. Prepare blinded examples of connected phrasing, an unhelpful split, an already useful pause, and an exaggerated pause. Include experiment, keep and undecided contexts. Ask at least two independent listeners to identify the phrase boundary, describe audible evidence and say whether any change is warranted; record disagreement rather than forcing a score.

For each learner, collect a first unfamiliar reading, the chosen listening decision in their own words, and a second different passage without showing the earlier script. Ask what they kept/changed and why. Independent listeners compare blinded excerpts for intended meaning and clarity, not merely longer gaps. Preserve “no change needed” and “insufficient evidence” outcomes. Record ASR availability/alignment errors separately from listener judgments. Report sample size, listener agreement, uncertainty and failures; a functioning browser scenario or model self-score cannot establish this result. This is a prepared protocol, not an already completed human evaluation.
