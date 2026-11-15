# Bounded live audio-coaching probe — 2026-11-15

This is a small integration diagnostic using public synthetic English speech, not a user study or proof of coaching accuracy. No guest data, human recordings or credentials are included. `scripts-evaluate-coaching.py` creates two FFmpeg/flite sentences with 1.2 seconds of inserted silence, then uses the configured ASR/audio provider. The resulting WAV is 6.525 seconds; all artifacts refer to the same SHA-256. The inserted silence is not the total acoustic sentence gap because the synthesizer has its own edge silence.

Four paid requests were made in total: two Whisper transcriptions and two gpt-audio-1.5 coaching requests. No request was automatically retried. The cached-transcription check made zero requests. The audio calls reused the recorded ASR result only after verifying the regenerated audio hash, expected text and transcription-model identity. Raw usage is retained; exact billed cost is not asserted.

| Artifact | Requests | Result |
|---|---:|---|
| [Initial probe](live-coaching-2026-11-15.json) | 1 ASR | Correct 19-word transcript, but old strict timestamp validation rejected all timing and stopped before the audio model. |
| [Timing diagnostic](live-timing-diagnostic-2026-11-15.json) | 1 ASR | Saved the complete public transcript and word intervals; internal `river` had start=end=1.76 seconds. |
| [Offline cached check](cached-timing-check-2026-11-15.json) | 0 | After the fix, overall pace is 179.81 WPM; pauses and articulation rate remain unavailable. This older artifact has no explicit api_calls field and an empty usage list. |
| [First audio response after the fix](live-coaching-after-alignment-fix-2026-11-15.json) | 1 audio | Valid schema and grounded quote, but mechanical advice to lengthen an already audible pause. Also falsely claimed to have only transcript timing. |
| [Prompt-v2 audio response](live-coaching-prompt-v2-2026-11-15.json) | 1 audio | Valid schema and grounded quote. Removed the false lack-of-audio limitation, but again suggested a longer pause without explaining an audible deficit. |

Both audio requests report 65 audio input tokens, confirming audio input was processed. Quote matching locates actual recognized words; it does not validate the perceptual claim. The replay interval includes a partial-alignment uncertainty note. No audio timing was interpolated to obtain a passing result.

The prompt change asks the model to preserve a useful feature and transfer it into another text when appropriate, and to justify a proposed change with an audible reason. These two responses do not show that it reliably follows that instruction. They are separate nondeterministic calls, not a controlled causal experiment. The second response still calls a conspicuous sentence gap “brief”; no human listener assessment was collected. The product continues to label these as fallible AI listening notes and presents the user's own listening check separately.

Confirmed: live request transport, text verification, strict response parsing, quote location, partial alignment handling and usage capture work for this single fixture. Unresolved: useful judgments on varied human voices, appropriate corrections instead of generic escalation, repeatability, and transfer of learning to unfamiliar speech. There is no basis here for a 9.5 product score.

## Reproduction

The CLI requires explicit `--allow-paid-calls`, bounds each run to two network requests and a 20-second generated sample, and makes no automatic retries. Running it starts new paid work; it is excluded from normal tests and CI.

```sh
.venv/bin/python scripts-evaluate-coaching.py --allow-paid-calls --output /tmp/coaching-probe.json
```

To validate the captured timing without a network call, use both cached and transcription-only options. The explicit flag is still required to acknowledge this is the opt-in live diagnostic CLI; this particular combination performs no provider request.

```sh
.venv/bin/python scripts-evaluate-coaching.py --allow-paid-calls \
  --cached-transcript docs/improvements/evaluations/live-timing-diagnostic-2026-11-15.json \
  --transcription-only --output /tmp/cached-timing-check.json
```

The real ASR response is also frozen as `tests/fixtures/whisper-internal-zero-word.json` for normal offline regression tests. Existing zero-length edges, mismatched counts, out-of-audio timestamps and unusably short spans remain unavailable.
