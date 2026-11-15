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

The current CLI accepts --intent experiment|keep|undecided and sends the choice with the current story rubric. The original four paid responses above still describe their historical prompts/context; they are not evidence for later prompt versions. A cached-transcription-only keep run has been checked with zero provider requests. To exercise another intention offline, add --intent keep (or undecided) to the cached command above; without --transcription-only, a new paid coaching request is made.

## Pinned public human recordings — offline preparation

`human-corpus-v1.json` freezes one short narrative phrase read by two CMU ARCTIC speakers (slt/bdl), exact official source URLs, checksums, file sizes and the cases. These are studio recordings of human readers, according to the [authors' description](https://www.cs.cmu.edu/~awb/papers/ssw5/arctic.pdf), rather than generated speech. The source [COPYING](cmu-arctic-COPYING.txt) is retained. No product guest recording was used. Original WAVs, automatic phonetic labels and Festival utterance data remain in git-ignored `models/evaluation-corpus`; only provenance and diagnostic text are committed.

The official server served these source files over HTTP; HTTPS connections were refused. Downloads are bounded by the pinned byte size and SHA-256 and never execute source content. Checksums make subsequent reproduction detect changed files; they are not a new claim of transport authentication. `scripts-prepare-human-audio.py` downloads only missing files with explicit `--download`, refuses changed cached files and uses no application settings or provider credentials.

```sh
.venv/bin/python scripts-prepare-human-audio.py --download
.venv/bin/python scripts-evaluate-human-offline.py --output /tmp/human-offline.json
```

The offline tool uses the installed pinned live-highlighting Zipformer and real VAD/audio-quality rules. It does not call assessment Whisper or any audio-coaching provider. Cases cover the unchanged slt reading with keep/undecided labels, the same human waveform with 700 ms of explicitly artificial silence after the second “the” plus a 3 ms de-click fade at each side, and the unchanged bdl reading. The edit cut follows automatic corpus phonetic timing; it is not a manual listener judgment or a real learner error. Keep/undecided cases share one waveform and are not independent recognition samples.

[Recorded offline result](offline-human-probe-v1-2026-11-15.json): all four case runs were accepted by audio-quality checks and exactly matched the reference tokens in this phrase. This covers two voices and only three distinct waveforms. Streaming timestamps are emission positions used for approximate highlighting; they are not substituted for word endpoints in assessment timing. Corpus phone alignment is automatic, not gold perceptual annotation. These checks do not establish coaching usefulness, ASR accuracy on other passages/accents, or learning transfer.

The existing opt-in live CLI now accepts `--human-case` from the fixed manifest. It verifies the waveform/license source hashes and uses the case's frozen intention; cached transcription still requires the exact generated-audio hash, expected text and provider transcription-model identity. It never accepts an arbitrary private audio path. Every run remains bounded to two provider requests without retries, and original/silence-edited source metadata remains in the artifact. No live human-case invocation has been made yet; the original four paid requests above remain the complete paid-call count. A future live probe must retain negative results and cannot stand in for independent human listening or a learner study.
