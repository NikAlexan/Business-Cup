# Bounded audio-coaching diagnostics — 2026-11-15

These are small integration diagnostics using public synthetic speech and licensed human recordings, not a user study or proof of coaching accuracy. No guest data or credentials are included; original human WAVs remain in ignored corpus storage. The first synthetic probe below predates the human cases. `scripts-evaluate-coaching.py` creates two FFmpeg/flite sentences with 1.2 seconds of inserted silence, then uses the configured ASR/audio provider. The resulting WAV is 6.525 seconds; all artifacts refer to the same SHA-256. The inserted silence is not the total acoustic sentence gap because the synthesizer has its own edge silence.

The historical synthetic probes made four paid requests: two Whisper transcriptions and two gpt-audio-1.5 coaching requests. The later human probes below add five; nine paid requests are now captured in this directory in total. No request was automatically retried. The cached-transcription check made zero requests. The audio calls reused the recorded ASR result only after verifying the regenerated audio hash, expected text and transcription-model identity. Raw usage is retained; exact billed cost is not asserted.

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

The existing opt-in live CLI now accepts `--human-case` from the fixed manifest. It verifies the waveform/license source hashes and uses the case's frozen intention; cached transcription still requires the exact generated-audio hash, expected text and provider transcription-model identity. It never accepts an arbitrary private audio path. Every run remains bounded to two provider requests without retries, and original/silence-edited source metadata remains in the artifact. The first live human-case probe is recorded below. The declared split and undecided cases were subsequently run as recorded below; the second human voice remains offline-only. A future live probe must retain negative results and cannot stand in for independent human listening or a learner study.


## First live human keep case — prompt v3

[Raw captured result](live-human-keep-v3-2026-11-15.json) uses the unchanged slt original (3.2050625 seconds), whose exact WAV hash matches the pinned source, with the predeclared keep focus. It made exactly two provider requests without retries: Whisper returned all eleven reference words and bounded timing; the audio model returned a valid report and a located “the two men” quote. Usage records4 billed-duration seconds reported by ASR and32 audio input tokens from coaching. Exact currency cost is unknown and is not estimated here.

The response supports carrying the connected phrase into a new phrase without making the feature stronger or proposing a longer pause. Its listening question remains generic about thought boundaries. This demonstrates transport, schema/quote validation and compliance with the keep intention in one public human recording. There was no blinded listener judgment of the model's claim, no learner intervention, no comparison across intentions or repeated generations, and no demonstration of transfer. This first result preceded the experiment/undecided probes below. The second voice remains untested with the paid provider. Historical weak synthetic responses remain negative evidence; this single response does not establish that v3 is generally better or justify a9.5 score.

To reproduce only the captured transcription/timing offline, without a new provider request (after source preparation):

```sh
.venv/bin/python scripts-evaluate-coaching.py --allow-paid-calls \
  --human-case slt-original-keep --transcription-only \
  --cached-transcript docs/improvements/evaluations/live-human-keep-v3-2026-11-15.json \
  --output /tmp/human-cached-timing.json
```

Omitting cached-transcript or transcription-only starts new paid work, still bounded to two requests per invocation. It is excluded from normal tests/CI.


## Subsequent v3 probes: adverse results, not discarded

Two more predeclared cases consumed exactly three additional requests, without retries:

- [Artificial article split, experiment](live-human-split-v3-2026-11-15.json): one ASR and one audio call. The human waveform has700ms of inserted silence at the corpus-aligned end of the second “the”, plus declared de-click fades. The model nevertheless described the group as connected with little gap and proposed a new pause before a different phrase. This fails the planned diagnostic criterion; the reply is preserved. Its pause metrics remain unavailable because Whisper assigned the article a zero-length interval. The playable quote expands to a wider phrase with an alignment note instead of inventing a precise boundary gap.
- [Unchanged original, undecided](live-human-undecided-v3-2026-11-15.json): one audio call reusing the hash/model/text-verified original ASR capture. The action proposes a new take with a new pause, and the question assumes that changed performance, contrary to listening before deciding. The raw result is preserved.

Five human-case requests plus four historical synthetic requests make nine captured paid calls. These three cases use one speaker/short phrase and compare different contexts/intentions; they are not a blinded controlled experiment, a comparison of repeated generations, or independent listener validation. The experiment note itself identifies the suspected gap, so even a successful response would not independently prove that the model detected it. No extra paid call was made to seek a better reply.

## Deterministic listening-decision policy

`listening-decision-v1` governs the next action in application feedback independently of model compliance. Keep carries the chosen feature without intensification; undecided only replays/inspects before deciding. The original model action/question remain in `model_next_step` and `model_listening_question`; `action_source=user_listening_decision` identifies substituted guidance. A later saved reflection takes priority for future practice, while the recorded objective remains its original snapshot. Experiment restores the original optional model idea. This policy does not verify or repair the model's auditory claim: `observation_status=hypothesis` and the UI mark it as an impression to check against playback.

The worker rechecks the current saved decision before publication; saving a later reflection reapplies the policy without another provider request or reward. The frontend applies the same decision to historical reports that lack policy metadata. [Offline replay](intent-policy-replay-v1-2026-11-15.json) preserves the SHA of each raw v3 capture and shows the deterministic action separately. Reproduce with:

```sh
.venv/bin/python scripts-replay-coaching-policy.py --output /tmp/intent-policy-replay.json
```

Prompt-v4 additionally requests a replay-only undecided action and a question about the existing recording. It has not received a new paid test. The code policy, rather than assumed prompt compliance, enforces the user decision. Regression tests use the captured adverse v3 response, including a decision saved while coaching is in flight; they do not prove the model now hears pauses accurately. Independent listening agreement and learner transfer remain unvalidated.
