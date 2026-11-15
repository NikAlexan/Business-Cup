import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post, request, useMutationWithKey } from '../api/api'
import { useAttempt, usePracticeFocus } from '../api/hooks'
import type { Attempt, PracticeFocusState, TrainingFocus } from '../api/types'
import { ErrorBanner } from './ui'

export function TakeReflection({ attempt, onSaved, storyId, exerciseId }: { attempt: Attempt; onSaved: (updated: Attempt) => void; storyId?: string; exerciseId?: string }) {
  const [note, setNote] = useState(attempt.reflection?.note ?? '')
  const [savedNote, setSavedNote] = useState(attempt.reflection?.note ?? '')
  const [skill, setSkill] = useState<string | null>(null)
  const qc = useQueryClient()
  const canCarry = attempt.status === 'passed' && !!attempt.recording_id
  const catalog = usePracticeFocus(canCarry)
  const detail = useAttempt(canCarry ? attempt.id : undefined)
  const suggestion = detail.data?.speech_review?.report?.next_step ?? attempt.feedback.next_step
  const defaultSkill = Object.entries(catalog.data?.skills ?? {}).find(([, entry]) => entry.exercise_ids.includes(exerciseId ?? attempt.exercise_id ?? ''))?.[0] ?? 'delivery'
  const active = catalog.data?.focus
  const chosenSkill = skill ?? (active?.source_attempt_id === attempt.id ? active.skill : '')
  const alreadyFocus = active?.source_attempt_id === attempt.id && active.note === note.trim() && active.skill === (chosenSkill || defaultSkill)
  const updated = (take: Attempt) => { setNote(take.reflection?.note ?? ''); setSavedNote(take.reflection?.note ?? ''); qc.setQueryData(['attempt', take.id], take); onSaved(take) }
  const save = useMutation({
    mutationFn: () => request<Attempt>('/exercise-attempts/' + attempt.id + '/reflection', { method: 'PUT', body: { note } }),
    onSuccess: updated,
  })
  const carry = useMutationWithKey((value: { source_attempt_id: string; note: string; skill?: string }, key) => post<{ focus: TrainingFocus; source_attempt: Attempt }>('/practice-focus', value, key))
  const id = 'reflection-' + attempt.id
  return <div className="rs-stack" style={{ gap: 8 }}>
    <label htmlFor={id} style={{ fontWeight: 500 }}>What did you hear, and what will you try next?</label>
    <textarea id={id} maxLength={500} rows={3} value={note} disabled={save.isPending || carry.isPending} onChange={(event) => setNote(event.target.value)}
      placeholder="Choose one small change for your next take."
      style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 12, border: '2px solid var(--line)', background: 'var(--ground)', color: 'var(--ink)', font: 'inherit' }} />
    {save.error && <ErrorBanner error={save.error} onRetry={() => save.mutate()} />}
    {save.isSuccess && note === savedNote && <span className="rs-label" role="status">Reflection saved with this take.</span>}
    {canCarry && suggestion && <button className="rs-link" type="button" disabled={save.isPending || carry.isPending} onClick={() => setNote(suggestion)}>Use suggested change</button>}
    <button className="rs-btn rs-btn--secondary" type="button" disabled={save.isPending || carry.isPending || note === savedNote} onClick={() => save.mutate()} style={{ alignSelf: 'flex-start' }}>Save reflection</button>
    {canCarry && <div className="rs-stack" style={{ gap: 10 }}>
      <label className="rs-stack" style={{ gap: 6 }}>Focus for story practice
        <select value={chosenSkill} disabled={carry.isPending || save.isPending} onChange={(event) => setSkill(event.target.value)} style={{ font: 'inherit', padding: 10, background: 'var(--ground)', color: 'var(--ink)', border: '2px solid var(--line)', borderRadius: 12 }}>
          <option value="">Suggested for this exercise</option>
          {Object.entries(catalog.data?.skills ?? {}).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
        </select>
      </label>
      <span className="rs-label">Keep one change for a new story and your next session. This also saves the reflection with this take.</span>
      <button className="rs-btn rs-btn--secondary" type="button" disabled={carry.isPending || save.isPending || !note.trim() || alreadyFocus} onClick={() => carry.mutate({ source_attempt_id: attempt.id, note, ...(chosenSkill ? { skill: chosenSkill } : {}) }, { onSuccess: (data) => {
        updated(data.source_attempt)
        qc.setQueryData<PracticeFocusState>(['practice-focus'], (previous) => ({ focus: data.focus, skills: previous?.skills ?? {}, last_check: null }))
        void qc.invalidateQueries({ queryKey: ['practice-focus'] }); void qc.invalidateQueries({ queryKey: ['plan-item'] })
      } })}>Save for story practice</button>
      {alreadyFocus && <span role="status" className="rs-label">Saved for story practice and your next session.</span>}
      {alreadyFocus && storyId && <Link className="rs-link" to={'/exercise/' + storyId}>Open the story</Link>}
      {carry.error && <ErrorBanner error={carry.error} />}
      {catalog.error && <ErrorBanner error={catalog.error} onRetry={() => catalog.refetch()} />}
    </div>}
  </div>
}
