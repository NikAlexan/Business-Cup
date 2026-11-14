import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { request } from '../api/api'
import type { Attempt } from '../api/types'
import { ErrorBanner } from './ui'

export function TakeReflection({ attempt, onSaved }: { attempt: Attempt; onSaved: (updated: Attempt) => void }) {
  const [note, setNote] = useState(attempt.reflection?.note ?? '')
  const [savedNote, setSavedNote] = useState(attempt.reflection?.note ?? '')
  const save = useMutation({
    mutationFn: () => request<Attempt>('/exercise-attempts/' + attempt.id + '/reflection', { method: 'PUT', body: { note } }),
    onSuccess: (updated) => { setNote(updated.reflection?.note ?? ''); setSavedNote(updated.reflection?.note ?? ''); onSaved(updated) },
  })
  const id = 'reflection-' + attempt.id
  return <div className="rs-stack" style={{ gap: 8 }}>
    <label htmlFor={id} style={{ fontWeight: 500 }}>What did you hear, and what will you try next?</label>
    <textarea id={id} maxLength={500} rows={3} value={note} onChange={(event) => setNote(event.target.value)}
      placeholder="Choose one small change for your next take."
      style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 12, border: '2px solid var(--line)', background: 'var(--ground)', color: 'var(--ink)', font: 'inherit' }} />
    {save.error && <ErrorBanner error={save.error} onRetry={() => save.mutate()} />}
    {save.isSuccess && note === savedNote && <span className="rs-label" role="status">Reflection saved with this take.</span>}
    <button className="rs-btn rs-btn--secondary" type="button" disabled={save.isPending || note === savedNote} onClick={() => save.mutate()} style={{ alignSelf: 'flex-start' }}>Save reflection</button>
  </div>
}
