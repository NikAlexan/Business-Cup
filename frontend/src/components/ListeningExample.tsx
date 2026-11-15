import { AudioPlayer } from './AudioPlayer'
import { useEffect, useRef, useState } from 'react'
import { post, useMutationWithKey } from '../api/api'
import type { ListeningBoundary, ListeningExampleData, ListeningPlan, PlannedPauseFeedback } from '../api/types'
import { ErrorBanner } from './ui'

export function PlannedBoundary({ plan, feedback, onHear }: { plan: ListeningPlan; feedback?: PlannedPauseFeedback; onHear?: (seconds: number) => void }) {
  return <section className="rs-card rs-stack" aria-label="Your chosen boundary" style={{ padding: 20, gap: 8 }}>
    <h3 className="rs-h rs-h3">Boundary for this take</h3>
    <p style={{ margin: 0 }}>{plan.before} <strong>/</strong> {plan.after}</p>
    {feedback && <p>{feedback.available && feedback.gap_seconds !== null
      ? `About ${feedback.gap_seconds.toFixed(1)} seconds between the recognized words at your boundary. This does not judge the phrasing.`
      : 'Timing at this boundary is unavailable. Listen back to check the phrasing.'}</p>}
    {feedback?.evidence && <button className="rs-link" type="button" disabled={!onHear} onClick={() => onHear?.(feedback.evidence!.start_seconds)}>Hear your chosen boundary: “{feedback.evidence.quote}”</button>}
    <span className="rs-label">Does this boundary help the thought land? Keep what works; another take is optional.</span>
  </section>
}

export function ListeningExample({ itemId, example, boundaries, plan, locked, onSaved, onBusy }: {
  itemId: string; example: ListeningExampleData; boundaries: ListeningBoundary[]; plan?: ListeningPlan | null
  locked: boolean; onSaved: (receipt: ListeningPlan) => Promise<ListeningPlan | null>; onBusy: (busy: boolean) => void
}) {
  const [answer, setAnswer] = useState<'a' | 'b' | 'unsure' | null>(null)
  const [boundary, setBoundary] = useState<number | null>(null)
  const [audioError, setAudioError] = useState(false)
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  const players = useRef<(HTMLAudioElement | null)[]>([])
  const save = useMutationWithKey(async (body: { example_id: string; answer: 'a' | 'b' | 'unsure'; boundary_index: number }, key) => {
    const receipt = await post<ListeningPlan>('/plan-items/' + itemId + '/listening-plan', body, key)
    const current = await onSaved(receipt)
    return { receipt, current }
  })
  useEffect(() => { onBusy(save.isPending); return () => onBusy(false) }, [save.isPending, onBusy])
  useEffect(() => { if (locked) players.current.forEach((audio) => audio?.pause()) }, [locked])
  const editingAnswer = answer ?? plan?.answer ?? null
  const editingBoundary = boundary ?? plan?.boundary_index ?? null
  const selectedAnswer = locked ? plan?.answer ?? null : editingAnswer
  const selectedBoundary = locked ? plan?.boundary_index ?? null : editingBoundary
  const alreadySaved = !!plan && plan.example.id === example.id && plan.answer === editingAnswer && plan.boundary_index === editingBoundary
  // Mockup: a sky card marked Optional, with its note inside the card rather than floating under it.
  return <section className="rs-card rs-stack" aria-label="Optional listening practice" style={{ gap: 12, padding: 20, background: 'var(--sky-tint)' }}>
    <details>
      <summary className="rs-disclosure" style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><span className="rs-h" style={{ fontSize: 18 }}>Listen to a short pause comparison</span><span className="rs-badge" style={{ background: 'var(--ground)', color: 'var(--sky-ink)' }}>Optional</span></summary>
      <div className="rs-stack" style={{ gap: 12, marginTop: 12 }}>
        <p style={{ margin: 0 }}>{example.text}</p>
        <span className="rs-label">{example.provenance_note}</span>
        <div className="rs-stack" style={{ gap: 10, display: locked ? 'none' : undefined }}>
          {example.choices.map((choice, index) => <div className="rs-stack" key={choice.id} style={{ gap: 6 }}>Version {choice.label}
            <AudioPlayer ref={(element) => { players.current[index] = element }} preload="none" aria-label={'Pause example ' + choice.label} src={choice.audio_url} onError={() => setAudioError(true)} />
          </div>)}
        </div>
        {audioError && !locked && <div role="alert"><p>The examples could not load. You can read the pause patterns and continue your own practice.</p><button type="button" className="rs-link" onClick={() => { setAudioError(false); players.current.forEach((audio) => audio?.load()) }}>Retry examples</button></div>}
        <fieldset disabled={locked || save.isPending} style={{ padding: 0, margin: 0, border: 0 }}>
          <legend style={{ fontWeight: 500 }}>{example.question}</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
            {(['a', 'b', 'unsure'] as const).map((value) => <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="radio" name={'example-' + itemId} checked={selectedAnswer === value} onChange={() => setAnswer(value)} />{value === 'unsure' ? 'Not sure' : 'Version ' + value.toUpperCase()}</label>)}
          </div>
        </fieldset>
        <details><summary>Read the pause patterns</summary>{example.choices.map((choice) => <p key={choice.id}><strong>{choice.label}:</strong> {choice.paused_text}</p>)}</details>
        {selectedAnswer && <div className="rs-stack rs-gap-2"><p style={{ margin: 0 }}>{example.explanation}</p><p style={{ margin: 0 }}>{example.transfer_prompt}</p></div>}
        {!!boundaries.length && <fieldset disabled={locked || save.isPending} style={{ padding: 0, margin: 0, border: 0 }}>
          <legend style={{ fontWeight: 500 }}>Choose a boundary to listen for in your take</legend>
          <div className="rs-stack" style={{ gap: 8, marginTop: 8 }}>{boundaries.map((entry) => <label key={entry.index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <input type="radio" name={'boundary-' + itemId} checked={selectedBoundary === entry.index} onChange={() => setBoundary(entry.index)} /><span>{entry.before} / {entry.after}</span>
          </label>)}</div>
        </fieldset>}
        <button className="rs-btn rs-btn--secondary" type="button" disabled={locked || save.isPending || !editingAnswer || editingBoundary === null || alreadySaved} onClick={() => {
          if (editingAnswer && editingBoundary !== null) save.mutate({ example_id: example.id, answer: editingAnswer, boundary_index: editingBoundary }, { onSuccess: ({ receipt, current }) => { setAnswer(null); setBoundary(null); setChangedElsewhere(current?.id !== receipt.id) } })
        }}>Use this boundary for my take</button>
        {plan && !alreadySaved && !locked && <span className="rs-label">Save your new selection to replace the saved boundary shown below.</span>}
        {save.isPending && <span role="status">Saving your listening plan…</span>}
        {changedElsewhere && <p role="status">A newer boundary was saved elsewhere. The latest saved boundary is shown below.</p>}
        {save.error && <ErrorBanner error={save.error} />}
        <a className="rs-link" href={example.notice_url} target="_blank" rel="noreferrer">Synthetic example credits</a>
      </div>
    </details>
    {plan ? <PlannedBoundary plan={plan} /> : locked ? <p className="rs-label">This take started without a saved boundary.</p> : <span className="rs-label">Optional: save a boundary before recording to carry it into the take. Listening choices do not add notes or complete the exercise.</span>}
  </section>
}
