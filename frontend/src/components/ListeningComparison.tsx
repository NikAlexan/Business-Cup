import { AudioPlayer } from './AudioPlayer'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, post, request, useMutationWithKey } from '../api/api'
import type { TakeListeningChoice, TakeListeningComparison } from '../api/types'
import { pauseOtherAudio } from '../lib/audioPlayback'
import { ErrorBanner } from './ui'

const CHOICES: [TakeListeningChoice, string][] = [
  ['a', 'Version A supports the meaning more clearly'],
  ['b', 'Version B supports the meaning more clearly'],
  ['no_clear_difference', 'I hear no clear difference'],
  ['unsure', 'I am not sure'],
]

function keepRevealed(current: TakeListeningComparison | null, incoming: TakeListeningComparison) {
  return current?.id === incoming.id && current.result && !incoming.result ? current : incoming
}

export function ListeningComparison({ takeId }: { takeId: string }) {
  const [opened, setOpened] = useState(false)
  const [comparison, setComparison] = useState<TakeListeningComparison | null>(null)
  const [choice, setChoice] = useState<TakeListeningChoice | null>(null)
  const [note, setNote] = useState('')
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  const [audioErrors, setAudioErrors] = useState<string[]>([])
  const dialog = useRef<HTMLDialogElement>(null)
  const players = useRef<Partial<Record<'a' | 'b', HTMLAudioElement>>>({})
  const id = useId()
  const load = useMutationWithKey(async (_: null, key) => {
    const receipt = await post<TakeListeningComparison>('/exercise-attempts/' + takeId + '/comparison', {}, key)
    // A receipt can predate an answer in another tab. Read the saved comparison before displaying it.
    return request<TakeListeningComparison>('/listening-comparisons/' + receipt.id)
  })
  const apply = (incoming: TakeListeningComparison) => setComparison((current) => keepRevealed(current, incoming))
  const save = useMutation({
    mutationFn: async (value: { choice: TakeListeningChoice; note: string }) => {
      try {
        return { data: await request<TakeListeningComparison>('/listening-comparisons/' + comparison!.id + '/result', { method: 'PUT', body: value }), conflict: false }
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'comparison_already_answered') throw error
        return { data: await request<TakeListeningComparison>('/listening-comparisons/' + comparison!.id), conflict: true }
      }
    },
    onSuccess: ({ data, conflict }) => { apply(data); setChangedElsewhere(conflict) },
  })
  const busy = load.isPending || save.isPending
  const close = () => { pauseOtherAudio(); setOpened(false) }
  useEffect(() => {
    const modal = dialog.current
    if (opened && modal && !modal.open) { pauseOtherAudio(); modal.showModal() }
    else if (!opened && modal?.open) modal.close()
    return () => { if (modal?.open) modal.close(); pauseOtherAudio() }
  }, [opened])
  const open = () => {
    setOpened(true)
    if (!busy) load.mutate(null, { onSuccess: apply })
  }
  const draftDiffers = !!comparison?.result && !!choice && (comparison.result.choice !== choice || comparison.result.note !== note.trim())
  return <>
    <button className="rs-btn rs-btn--secondary" type="button" onClick={open}>Compare with A/B labels</button>
    <dialog ref={dialog} aria-labelledby={id + '-title'} aria-describedby={id + '-description'} onCancel={(event) => { event.preventDefault(); close() }} onClose={() => setOpened(false)} className="rs-card"
      style={{ width: 'min(620px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 32px)', boxSizing: 'border-box', overflowWrap: 'anywhere', border: '2px solid var(--line)', color: 'var(--ink)' }}>
      <div className="rs-stack rs-gap-4">
        <button className="rs-btn rs-btn--quiet" type="button" onClick={close} style={{ alignSelf: 'flex-end' }}>Close comparison</button>
        <h2 id={id + '-title'} className="rs-h" style={{ fontSize: 24 }}>Listen to your two takes</h2>
        <p id={id + '-description'} style={{ margin: 0 }}>The previous/current labels stay hidden until you save your first answer. You may recognize your own takes; this is a personal listening check, not an independent test.</p>
        {load.isPending && <p role="status">Loading your saved comparison…</p>}
        {load.error && <ErrorBanner error={load.error} onRetry={() => load.mutate(null, { onSuccess: apply })} />}
        {comparison && <>
          <p style={{ margin: 0 }}>{comparison.question}</p>
          {comparison.focus_note && <p style={{ margin: 0 }}><strong>Listening focus:</strong> {comparison.focus_note}</p>}
          {comparison.focus_changed && <p className="rs-label">The chosen focus changed between these takes. Keep that context in mind; a difference does not establish improvement.</p>}
          {comparison.text && <details><summary className="rs-link">Read the assigned text</summary><p>{comparison.text}</p><p className="rs-label">Your actual delivery may differ from the assigned text.</p></details>}
          {comparison.clips.map((clip) => <div className="rs-stack" key={clip.label} style={{ gap: 8 }}>
            <strong>Version {clip.label.toUpperCase()}{clip.role ? ' · ' + (clip.role === 'previous' ? 'Previous take' : 'Repeated take') : ''}</strong>
            <AudioPlayer ref={(element) => { if (element) players.current[clip.label] = element; else delete players.current[clip.label] }} preload="metadata" aria-label={'Comparison version ' + clip.label.toUpperCase()} src={clip.audio_url}
              onError={() => setAudioErrors((errors) => errors.includes(clip.label) ? errors : [...errors, clip.label])}
              onCanPlay={() => setAudioErrors((errors) => errors.filter((label) => label !== clip.label))} />
            {audioErrors.includes(clip.label) && <ErrorBanner text={'Version ' + clip.label.toUpperCase() + ' could not load. Try loading this saved audio again.'} onRetry={() => players.current[clip.label]?.load()} />}
          </div>)}
          {comparison.result ? <section className="rs-stack" aria-label="Saved listening answer" style={{ gap: 10 }}>
            {changedElsewhere && <p role="status">An answer was already saved. The first saved answer is shown below.</p>}
            <strong>Your first answer: {CHOICES.find(([value]) => value === comparison.result!.choice)?.[1]}</strong>
            {comparison.result.note && <p style={{ margin: 0 }}>{comparison.result.note}</p>}
            <p className="rs-label">Saved before these labels were revealed. This is your listening impression, not a grade or evidence that the repeated take is better.</p>
            {draftDiffers && <div className="rs-card"><strong>Your unsubmitted draft was kept</strong><p>{CHOICES.find(([value]) => value === choice)?.[1]}</p><p>{note}</p><span className="rs-label">It has not replaced the first answer. You can add further thoughts in your take’s listening note after closing this window.</span></div>}
          </section> : <>
            <fieldset disabled={busy || !!load.error} style={{ border: 0, margin: 0, padding: 0 }}>
              <legend style={{ fontWeight: 500, marginBottom: 8 }}>After listening to both, what do you hear?</legend>
              <div className="rs-stack rs-gap-3">{CHOICES.map(([value, label]) => <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="radio" name={id + '-choice'} checked={choice === value} onChange={() => setChoice(value)} />{label}
              </label>)}</div>
            </fieldset>
            <label htmlFor={id + '-note'}>What did you hear? <span className="rs-label">Optional</span></label>
            <textarea id={id + '-note'} maxLength={500} rows={3} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 12, border: '2px solid var(--line)', borderRadius: 12, background: 'var(--ground)', color: 'var(--ink)', font: 'inherit' }} />
            {save.error && <ErrorBanner error={save.error} />}
            <p className="rs-label">Saving reveals which take is which and keeps this first answer. You can continue practice without answering. No notes, minutes or skill level are awarded here.</p>
            <button className="rs-btn" type="button" disabled={!choice || busy || !!load.error} onClick={() => save.mutate({ choice: choice!, note })}>{save.isPending ? 'Saving…' : 'Save answer and reveal takes'}</button>
          </>}
        </>}
      </div>
    </dialog>
  </>
}
