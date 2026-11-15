import { AudioPlayer } from './AudioPlayer'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { request } from '../api/api'
import type { Attempt, FocusOutcome, TrainingFocus } from '../api/types'
import { ErrorBanner } from './ui'

export const OUTCOMES: [FocusOutcome, string][] = [['heard', 'I can hear it'], ['partly', 'Partly'], ['not_yet', 'Not yet'], ['unsure', 'Not sure']]

export function StoryFocus({ focus, recording = false, completed = false }: { focus: TrainingFocus; recording?: boolean; completed?: boolean }) {
  const source = useRef<HTMLAudioElement>(null)
  useEffect(() => { if (recording) source.current?.pause() }, [recording])
  return <section className="rs-card rs-stack" aria-label="One focus for this story" style={{ padding: 22, gap: 10 }}>
    <h2 className="rs-h rs-h2">{completed ? 'Focus used for this take' : 'One focus for this story'}</h2>
    <span className="rs-label">{focus.intent === 'keep' ? 'Keep a useful feature' : focus.intent === 'experiment' ? 'One optional experiment' : 'Saved practice focus'}</span>
    <p style={{ margin: 0 }}><strong>{focus.skill_label}:</strong> {focus.note}</p>
    {!completed && <ol style={{ margin: 0, paddingLeft: 22 }}>{focus.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
    <p style={{ margin: 0 }}><strong>Listen for:</strong> {focus.listening_question}</p>
    <details hidden={recording}>
      <summary>Listen to the source take</summary>
      <AudioPlayer ref={source} preload="none" aria-label="Source take for this focus" src={'/api/v1/recordings/' + focus.source_recording_id + '/audio'} />
    </details>
  </section>
}

export function FocusCheck({ take, onSaved }: { take: Attempt; onSaved: (attempt: Attempt) => void }) {
  const qc = useQueryClient()
  const save = useMutation({ mutationFn: (outcome: FocusOutcome) => request<Attempt>('/exercise-attempts/' + take.id + '/focus-check', { method: 'PUT', body: { outcome } }),
    onSuccess: (updated) => { onSaved(updated); qc.setQueryData(['attempt', take.id], updated); void qc.invalidateQueries({ queryKey: ['practice-focus'] }) } })
  const selected = save.data?.focus_check?.outcome ?? take.focus_check?.outcome
  return <section className="rs-stack" aria-label="Your listening check" style={{ gap: 8 }}>
    <h3 className="rs-h rs-h3">{take.training_focus?.intent === 'keep' ? 'Could you hear the feature you wanted to keep?' : 'Could you hear your chosen change?'}</h3>
    <span className="rs-label">Your own listening check · you can change it after listening again</span>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {OUTCOMES.map(([value, label]) => <button className="rs-btn rs-btn--secondary" key={value} type="button" aria-pressed={selected === value} disabled={save.isPending} onClick={() => save.mutate(value)}>{label}</button>)}
    </div>
    {save.error && <ErrorBanner error={save.error} onRetry={() => save.variables && save.mutate(save.variables)} />}
    {save.isSuccess && <span role="status" className="rs-label">Listening check saved with this take.</span>}
  </section>
}
