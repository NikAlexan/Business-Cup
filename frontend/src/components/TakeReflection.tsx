import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post, request, useMutationWithKey } from '../api/api'
import { usePracticeFocus } from '../api/hooks'
import type { Attempt, PracticeFocusState, PracticeIntent, TrainingFocus } from '../api/types'
import { ErrorBanner } from './ui'

const INTENTS: [PracticeIntent, string][] = [['experiment', 'Try one small change'], ['keep', 'Keep a useful feature'], ['undecided', 'Listen again before deciding']]

export function TakeReflection({ attempt, onSaved, storyId, exerciseId }: { attempt: Attempt; onSaved: (updated: Attempt) => void; storyId?: string; exerciseId?: string }) {
  const [note, setNote] = useState(attempt.reflection?.note ?? '')
  const [savedNote, setSavedNote] = useState(attempt.reflection?.note ?? '')
  const [intent, setIntent] = useState<PracticeIntent | null>(null)
  const [savedIntent, setSavedIntent] = useState<PracticeIntent | null>(attempt.reflection?.intent ?? null)
  const [skill, setSkill] = useState<string | null>(null)
  const qc = useQueryClient()
  const canCarry = attempt.status === 'passed' && !!attempt.recording_id
  const catalog = usePracticeFocus(canCarry)
  const defaultSkill = Object.entries(catalog.data?.skills ?? {}).find(([, entry]) => entry.exercise_ids.includes(exerciseId ?? attempt.exercise_id ?? ''))?.[0] ?? 'delivery'
  const active = catalog.data?.focus
  const chosenSkill = skill ?? (active?.source_attempt_id === attempt.id ? active.skill : '')
  const chosenIntent = intent ?? savedIntent ?? (active?.source_attempt_id === attempt.id ? active.intent ?? 'experiment' : null)
  const alreadyFocus = active?.source_attempt_id === attempt.id && active.note === note.trim() && active.skill === (chosenSkill || defaultSkill) && (active.intent ?? 'experiment') === chosenIntent
  const updated = (take: Attempt) => {
    setNote(take.reflection?.note ?? ''); setSavedNote(take.reflection?.note ?? '')
    setSavedIntent(take.reflection?.intent ?? chosenIntent)
    qc.setQueryData(['attempt', take.id], take); onSaved(take)
  }
  const save = useMutation({
    mutationFn: () => request<Attempt>('/exercise-attempts/' + attempt.id + '/reflection', { method: 'PUT', body: { note, ...(chosenIntent ? { intent: chosenIntent } : {}) } }),
    onSuccess: updated,
  })
  const carry = useMutationWithKey((value: { source_attempt_id: string; note: string; intent: 'experiment' | 'keep'; skill?: string }, key) => post<{ focus: TrainingFocus; source_attempt: Attempt }>('/practice-focus', value, key))
  const busy = save.isPending || carry.isPending
  const dirty = note !== savedNote || chosenIntent !== savedIntent
  const carryFocus = () => {
    if (chosenIntent !== 'experiment' && chosenIntent !== 'keep') return
    carry.mutate({ source_attempt_id: attempt.id, note, intent: chosenIntent, ...(chosenSkill ? { skill: chosenSkill } : {}) }, { onSuccess: (data) => {
      updated(data.source_attempt)
      qc.setQueryData<PracticeFocusState>(['practice-focus'], (previous) => ({ focus: data.focus, skills: previous?.skills ?? {}, last_check: null }))
      void qc.invalidateQueries({ queryKey: ['practice-focus'] }); void qc.invalidateQueries({ queryKey: ['plan-item'] })
    } })
  }
  const id = 'reflection-' + attempt.id
  return <section className="rs-stack" aria-label="Your next practice decision" style={{ gap: 10 }}>
    {canCarry && <fieldset disabled={busy} style={{ margin: 0, padding: 0, border: 0 }}>
      <legend style={{ fontWeight: 500, marginBottom: 8 }}>After listening, what will you do?</legend>
      <div className="rs-stack" style={{ gap: 8 }}>
        {INTENTS.map(([value, title]) => <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="radio" name={'intent-' + attempt.id} value={value} checked={chosenIntent === value} onChange={() => setIntent(value)} />{title}
        </label>)}
      </div>
    </fieldset>}
    <label htmlFor={id} style={{ fontWeight: 500 }}>Your listening note</label>
    <textarea id={id} maxLength={500} rows={3} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)}
      placeholder={chosenIntent === 'keep' ? 'Name a phrase and the useful feature you want to keep.' : chosenIntent === 'experiment' ? 'Name a phrase and why you want to try one change.' : chosenIntent === 'undecided' ? 'What would you like to listen for again? A note is optional.' : 'What helped the meaning, or what would you like to explore?'}
      style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 12, border: '2px solid var(--line)', background: 'var(--ground)', color: 'var(--ink)', font: 'inherit' }} />
    {canCarry && <span className="rs-label">Choose from your own playback. A useful feature can stay as it is; an AI idea is optional.</span>}
    {save.error && <ErrorBanner error={save.error} onRetry={() => save.mutate()} />}
    {save.isSuccess && !dirty && <span className="rs-label" role="status">Reflection saved with this take.</span>}
    <button className="rs-btn rs-btn--secondary" type="button" disabled={busy || !dirty} onClick={() => save.mutate()} style={{ alignSelf: 'flex-start' }}>Save reflection</button>
    {canCarry && chosenIntent === 'undecided' && <div className="rs-stack" style={{ gap: 6 }}>
      <p style={{ margin: 0 }}>You can listen again without choosing a change. This note stays with the take.</p>
      {active && <p className="rs-label">Your existing story focus stays in place until you replace or clear it. <Link className="rs-link" to="/today">Review current focus</Link></p>}
    </div>}
    {canCarry && chosenIntent !== 'undecided' && <div className="rs-stack" style={{ gap: 10 }}>
      <label className="rs-stack" style={{ gap: 6 }}>Focus for story practice
        <select value={chosenSkill} disabled={busy} onChange={(event) => setSkill(event.target.value)} style={{ font: 'inherit', padding: 10, background: 'var(--ground)', color: 'var(--ink)', border: '2px solid var(--line)', borderRadius: 12 }}>
          <option value="">Suggested for this exercise</option>
          {Object.entries(catalog.data?.skills ?? {}).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
        </select>
      </label>
      <span className="rs-label">{chosenIntent === 'keep' ? 'Carry this useful feature into a new story without making it stronger.' : 'Choose one small experiment to test in a new story.'} This also saves your listening decision.</span>
      <button className="rs-btn rs-btn--secondary" type="button" disabled={busy || !note.trim() || !chosenIntent || alreadyFocus} onClick={carryFocus}>Save for story practice</button>
      {alreadyFocus && <span role="status" className="rs-label">Saved for story practice and your next session.</span>}
      {alreadyFocus && storyId && <Link className="rs-link" to={'/exercise/' + storyId}>Open the story</Link>}
      {carry.error && <ErrorBanner error={carry.error} />}
    </div>}
    {canCarry && catalog.error && <ErrorBanner error={catalog.error} onRetry={() => catalog.refetch()} />}
  </section>
}
