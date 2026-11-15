import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, post, request, useMutationWithKey } from '../api/api'
import { usePracticeFocus } from '../api/hooks'
import type { Attempt, PracticeFocusState, PracticeIntent, TrainingFocus } from '../api/types'
import { ErrorBanner } from './ui'
import { reconcileAttempt } from '../lib/attemptView'

const INTENTS: [PracticeIntent, string][] = [['experiment', 'Try one small change'], ['keep', 'Keep a useful feature'], ['undecided', 'Listen again before deciding']]

export function TakeReflection({ attempt, onSaved, storyId, exerciseId }: { attempt: Attempt; onSaved: (updated: Attempt) => void; storyId?: string; exerciseId?: string }) {
  const savedNote = attempt.reflection?.note ?? ''
  const savedIntent = attempt.reflection?.intent ?? null
  const revision = attempt.reflection?.revision ?? 0
  const [noteDraft, setNoteDraft] = useState<{ value: string; base: string } | null>(null)
  const [intentDraft, setIntentDraft] = useState<{ value: PracticeIntent; base: PracticeIntent | null } | null>(null)
  const note = noteDraft?.value ?? savedNote
  const noteConflict = !!noteDraft && savedNote !== noteDraft.base && savedNote !== noteDraft.value
  const intentConflict = !!intentDraft && savedIntent !== intentDraft.base && savedIntent !== intentDraft.value
  const conflict = noteConflict || intentConflict
  const [skill, setSkill] = useState<string | null>(null)
  const [focusReplaced, setFocusReplaced] = useState(false)
  const qc = useQueryClient()
  const canCarry = attempt.status === 'passed' && !!attempt.recording_id
  const catalog = usePracticeFocus(canCarry)
  const defaultSkill = Object.entries(catalog.data?.skills ?? {}).find(([, entry]) => entry.exercise_ids.includes(exerciseId ?? attempt.exercise_id ?? ''))?.[0] ?? 'delivery'
  const active = catalog.data?.focus
  const chosenSkill = skill ?? (active?.source_attempt_id === attempt.id ? active.skill : '')
  const chosenIntent = intentDraft?.value ?? savedIntent ?? (active?.source_attempt_id === attempt.id ? active.intent ?? 'experiment' : null)
  const alreadyFocus = active?.source_attempt_id === attempt.id && active.note === note.trim() && active.skill === (chosenSkill || defaultSkill) && (active.intent ?? 'experiment') === chosenIntent
  const applyCurrent = (take: Attempt) => {
    const cached = qc.getQueryData<Attempt>(['attempt', take.id])
    const current = reconcileAttempt(reconcileAttempt(attempt, cached), take, true) ?? take
    qc.setQueryData(['attempt', current.id], current); onSaved(current)
    return current
  }
  const updated = (take: Attempt) => {
    const current = applyCurrent(take)
    const superseded = (noteDraft && current.reflection?.note !== noteDraft.value.trim()) ||
      (intentDraft && current.reflection?.intent !== intentDraft.value)
    if (!superseded) { setNoteDraft(null); setIntentDraft(null) }
  }
  const acceptConflict = (error: Error) => {
    if (!(error instanceof ApiError) || error.code !== 'reflection_changed') return
    const data = error.details as { current_attempt?: Attempt } | undefined
    if (data?.current_attempt?.id === attempt.id) applyCurrent(data.current_attempt)
  }
  const save = useMutation({
    mutationFn: () => request<Attempt>('/exercise-attempts/' + attempt.id + '/reflection', { method: 'PUT', body: { note, expected_revision: revision, ...(intentDraft ? { intent: intentDraft.value } : {}) } }),
    onSuccess: updated,
    onError: acceptConflict,
  })
  const carry = useMutationWithKey(async (value: { source_attempt_id: string; note: string; intent: 'experiment' | 'keep'; skill?: string; expected_reflection_revision: number }, key) => {
    const receipt = await post<{ focus: TrainingFocus; source_attempt: Attempt }>('/practice-focus', value, key)
    await Promise.all([
      qc.cancelQueries({ queryKey: ['practice-focus'], exact: true }),
      qc.cancelQueries({ queryKey: ['attempt', attempt.id], exact: true }),
    ])
    const [state, source] = await Promise.all([
      request<PracticeFocusState>('/practice-focus'),
      request<Attempt>('/exercise-attempts/' + attempt.id),
    ])
    return { receipt, state, source: reconcileAttempt(receipt.source_attempt, source) ?? source }
  })
  const busy = save.isPending || carry.isPending
  const dirty = note !== savedNote || (!!intentDraft && chosenIntent !== savedIntent)
  const carryFocus = () => {
    if (conflict || (chosenIntent !== 'experiment' && chosenIntent !== 'keep')) return
    const value = { source_attempt_id: attempt.id, note, intent: chosenIntent, expected_reflection_revision: revision, ...(chosenSkill ? { skill: chosenSkill } : {}) }
    const previous = carry.variables
    // A refetch may reveal our own committed revision after a lost reply. Keep that operation's receipt key.
    const retry = carry.isError && previous && previous.source_attempt_id === value.source_attempt_id &&
      previous.note === value.note && previous.intent === value.intent && previous.skill === value.skill
    carry.mutate(retry ? previous : value, { onSuccess: (data) => {
      updated(data.source)
      qc.setQueryData(['practice-focus'], data.state)
      setFocusReplaced(data.state.focus?.id !== data.receipt.focus.id)
      void qc.invalidateQueries({ queryKey: ['plan-item'] })
    }, onError: acceptConflict })
  }
  const clearConflict = (keepDraft: boolean) => {
    setNoteDraft((draft) => keepDraft && draft ? { ...draft, base: savedNote } : null)
    setIntentDraft((draft) => keepDraft && draft ? { ...draft, base: savedIntent } : null)
    save.reset(); carry.reset()
  }
  const id = 'reflection-' + attempt.id
  return <section className="rs-stack" aria-label="Your next practice decision" style={{ gap: 10 }}>
    {canCarry && <fieldset disabled={busy} style={{ margin: 0, padding: 0, border: 0 }}>
      <legend style={{ fontWeight: 500, marginBottom: 8 }}>After listening, what will you do?</legend>
      <div className="rs-stack rs-gap-2">
        {INTENTS.map(([value, title]) => <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="radio" name={'intent-' + attempt.id} value={value} checked={chosenIntent === value} onChange={() => setIntentDraft(value === savedIntent ? null : { value, base: intentDraft ? intentDraft.base : savedIntent })} />{title}
        </label>)}
      </div>
    </fieldset>}
    <label htmlFor={id} style={{ fontWeight: 500 }}>Your listening note</label>
    <textarea id={id} maxLength={500} rows={3} value={note} disabled={busy} onChange={(event) => setNoteDraft(event.target.value === savedNote ? null : { value: event.target.value, base: noteDraft?.base ?? savedNote })}
      placeholder={chosenIntent === 'keep' ? 'Name a phrase and the useful feature you want to keep.' : chosenIntent === 'experiment' ? 'Name a phrase and why you want to try one change.' : chosenIntent === 'undecided' ? 'What would you like to listen for again? A note is optional.' : 'What helped the meaning, or what would you like to explore?'}
      style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 12, border: '2px solid var(--line)', background: 'var(--ground)', color: 'var(--ink)', font: 'inherit' }} />
    {canCarry && <span className="rs-label">Choose from your own playback. A useful feature can stay as it is; an AI idea is optional.</span>}
    {conflict && <div className="rs-card rs-stack" role="alert" style={{ padding: 16, gap: 10 }}>
      <strong>A saved reflection changed while you were editing. Your draft is kept.</strong>
      <p style={{ margin: 0 }}>Saved note: {savedNote || 'No note.'}</p>
      <p style={{ margin: 0 }}>Saved choice: {INTENTS.find(([value]) => value === savedIntent)?.[1] ?? 'No listening decision.'}</p>
      <p style={{ margin: 0 }}>The saved decision guides feedback until you save your draft.</p>
      <button className="rs-btn rs-btn--secondary" type="button" disabled={busy} onClick={() => clearConflict(false)}>Use saved reflection</button>
      <button className="rs-btn rs-btn--secondary" type="button" disabled={busy} onClick={() => clearConflict(true)}>Keep my draft for the next save</button>
    </div>}
    {save.error && <ErrorBanner error={save.error} onRetry={!conflict ? () => save.mutate() : undefined} />}
    {save.isSuccess && !dirty && <span className="rs-label" role="status">Reflection saved with this take.</span>}
    <button className="rs-btn rs-btn--secondary" type="button" disabled={busy || conflict || !dirty} onClick={() => save.mutate()} style={{ alignSelf: 'flex-start' }}>Save reflection</button>
    {canCarry && chosenIntent === 'undecided' && <div className="rs-stack rs-gap-2">
      <p style={{ margin: 0 }}>You can listen again without choosing a change. This note stays with the take.</p>
      {active && <p className="rs-label">Your existing story focus stays in place until you replace or clear it. <Link className="rs-link" to="/today">Review current focus</Link></p>}
    </div>}
    {canCarry && chosenIntent !== 'undecided' && <div className="rs-stack rs-gap-3">
      <label className="rs-stack rs-gap-2">Focus for story practice
        <select value={chosenSkill} disabled={busy} onChange={(event) => setSkill(event.target.value)} style={{ font: 'inherit', padding: 10, background: 'var(--ground)', color: 'var(--ink)', border: '2px solid var(--line)', borderRadius: 12 }}>
          <option value="">Suggested for this exercise</option>
          {Object.entries(catalog.data?.skills ?? {}).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)}
        </select>
      </label>
      <span className="rs-label">{chosenIntent === 'keep' ? 'Carry this useful feature into a new story without making it stronger.' : 'Choose one small experiment to test in a new story.'} This also saves your listening decision.</span>
      <button className="rs-btn rs-btn--secondary" type="button" disabled={busy || conflict || !note.trim() || !chosenIntent || alreadyFocus} onClick={carryFocus}>Save for story practice</button>
      {alreadyFocus && <span role="status" className="rs-label">Saved for story practice and your next session.</span>}
      {alreadyFocus && storyId && <Link className="rs-link" to={'/exercise/' + storyId}>Open the story</Link>}
      {carry.error && <ErrorBanner error={carry.error} />}
      {focusReplaced && <p role="status">Story focus changed elsewhere. <Link className="rs-link" to="/today">Review the current focus before your next story.</Link></p>}
    </div>}
    {canCarry && catalog.error && <ErrorBanner error={catalog.error} onRetry={() => catalog.refetch()} />}
  </section>
}
