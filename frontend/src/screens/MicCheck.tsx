import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, post, useMutationWithKey } from '../api/api'
import { useAssessment, useMe } from '../api/hooks'
import type { Assessment } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { FlowHeader } from '../components/FlowHeader'
import { LevelMeter, STATUS_TEXT } from '../components/LevelMeter'
import { MicBlocked } from '../components/MicBlocked'
import { ErrorBanner } from '../components/ui'
import { getMic, meter, micErrorKind, type Level, type MicErrorKind } from '../lib/recorder'

const ENVS = [
  ['quiet_room', 'Quiet room'],
  ['some_noise', 'Some noise'],
  ['noisy', 'Noisy'],
  ['unknown', 'Not sure'],
] as const
const select = { height: 48, borderRadius: 14, border: '2px solid var(--line)', padding: '0 14px', font: '400 16px var(--font-text)', background: 'var(--ground)', color: 'var(--ink)' }

export default function MicCheck() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reassessment = params.get('kind') === 'reassessment'
  const me = useMe(reassessment)
  const previous = useAssessment(reassessment ? me.data?.latest_assessment_id ?? undefined : undefined)
  const [setupFor, setSetupFor] = useState<string | null>(null)
  const [error, setError] = useState<MicErrorKind | null>(null)
  const [{ level, status }, setLevel] = useState<Level>({ level: 0, status: 'waiting' })
  const [device, setDevice] = useState('')
  const [distance, setDistance] = useState<number | null>(20)
  const [env, setEnv] = useState<string>('quiet_room')
  const [notes, setNotes] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const stopRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!reassessment || !previous.data || setupFor === previous.data.id) return
    const setup = previous.data.recording_conditions
    setDistance(setup?.distance_cm ?? null); setEnv(setup?.environment ?? 'unknown'); setNotes(setup?.notes ?? '')
    setSetupFor(previous.data.id)
  }, [reassessment, previous.data, setupFor])

  const open = useCallback(async () => {
    if (requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    setError(null)
    setDevice('')
    stopRef.current()
    try {
      const stream = await getMic(10_000, controller.signal)
      if (controller.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      let stopMeter = () => {}
      let disposed = false
      stopRef.current = () => {
        if (disposed) return
        disposed = true
        stopMeter()
        stream.getTracks().forEach((track) => track.stop())
      }
      stopMeter = meter(stream, setLevel)
      setDevice(stream.getAudioTracks()[0]?.label || 'Default microphone')

    } catch (e) {
      if (controller.signal.aborted) return
      stopRef.current()
      setError(micErrorKind(e, window.isSecureContext))
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }, [])
  useEffect(() => {
    void open()
    return () => {
      requestRef.current?.abort()
      requestRef.current = null
      stopRef.current()
    }
  }, [open])

  const create = useMutationWithKey((body: object, key) => post<Assessment>('/assessments', body, key))
  useRedirectOn401(create.error ?? me.error ?? previous.error)
  const go = () =>
    create.mutate(
      {
        kind: reassessment ? 'reassessment' : 'initial',
        demo_override: reassessment && params.get('demo') === '1',
        recording_conditions: { device_label: device || null, distance_cm: distance, environment: env, notes: notes.trim() || null },
      },
      {
        onSuccess: (a) => {
          stopRef.current()
          navigate('/record?assessment_id=' + a.id)
        },
        onError: (e) => {
          const id = (e as ApiError).details as { assessment_id?: string } | undefined
          if (e instanceof ApiError && e.code === 'assessment_in_progress' && id?.assessment_id) {
            stopRef.current()
            navigate('/record?assessment_id=' + id.assessment_id)
          }
        },
      },
    )

  return (
    <div className="rs rs-page">
      <FlowHeader back={reassessment ? '/check-in' : '/'}>
        <span className="rs-label">{reassessment ? 'Check-in' : 'Step 1 of 2'} · Mic check</span>
      </FlowHeader>
      <main className="rs-wrap rs-narrow" style={{ paddingTop: 24, paddingBottom: 56 }}>
        {error ? (
          <MicBlocked kind={error} onRetry={open} />
        ) : (
          <>
            <h1 className="rs-h rs-h1">Let's check your mic</h1>
            <p style={{ margin: '8px 0 28px', color: 'var(--muted)' }}>Say a few words in your normal voice.</p>
            <div className="rs-cols" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
              <div className="rs-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '32px 20px' }}>
                <LevelMeter level={level} label={'Input level: ' + STATUS_TEXT[status]} />
                <span className="rs-badge" style={status === 'good' ? { background: 'var(--success-tint)', color: 'var(--success)' } : status === 'loud' ? { background: 'var(--warning-tint)', color: 'var(--warning)' } : { background: 'var(--surface)', color: 'var(--muted)' }} aria-live="polite">
                  {device ? STATUS_TEXT[status] : 'Waiting for the mic…'}
                </span>
              </div>
              <form className="rs-stack rs-gap-4" aria-label="Recording setup" onSubmit={(e) => (e.preventDefault(), go())}>
                {reassessment && me.error && <ErrorBanner error={me.error} onRetry={() => me.refetch()} />}
                {reassessment && previous.error && <ErrorBanner error={previous.error} onRetry={() => previous.refetch()} />}
                {reassessment && !setupFor && !me.error && !previous.error && <p role="status">{me.data && !me.data.latest_assessment_id ? 'Complete your initial voice profile before starting a check-in.' : 'Loading your previous recording setup…'}</p>}
                {reassessment && previous.data && <section className="rs-card rs-stack" aria-label="Previous recording setup" style={{ padding: 18, gap: 8 }}>
                  <h2 className="rs-h rs-h3">{previous.data.analysis_metadata?.demo?.prepared_data ? 'Prepared demo setup' : 'Previous recording setup'}</h2>
                  <span>Microphone: {previous.data.recording_conditions?.device_label || 'Not recorded'}</span>
                  <span>Distance: {previous.data.recording_conditions?.distance_cm ? previous.data.recording_conditions.distance_cm + ' cm' : 'Not recorded'}</span>
                  <span>Room: {ENVS.find(([id]) => id === previous.data?.recording_conditions?.environment)?.[1] ?? 'Not recorded'}</span>
                  {previous.data.recording_conditions?.notes && <span>Notes: {previous.data.recording_conditions.notes}</span>}
                </section>}
                <div className="rs-stack rs-gap-1">
                  <h2 className="rs-h rs-h3">Your recording setup</h2>
                  <p style={{ margin: 0, fontSize: 15, color: 'var(--muted)' }}>
                    {reassessment ? 'Match the setup of your previous recording so the numbers compare.' : 'We save it with your baseline and ask you to match it at your next check-in.'}
                  </p>
                </div>
                <div className="rs-stack rs-gap-2">
                  <span style={{ font: '500 15px var(--font-text)' }}>Microphone</span>
                  <span className="rs-label">{device || '—'}</span>
                </div>
                <div className="rs-stack rs-gap-2">
                  <label htmlFor="dist" style={{ font: '500 15px var(--font-text)' }}>Distance to the mic</label>
                  <select id="dist" style={select} value={distance ?? ''} disabled={reassessment && !setupFor} onChange={(e) => setDistance(e.target.value ? +e.target.value : null)}>
                    <option value="">Not recorded</option>
                    <option value={20}>About a hand away (20 cm)</option>
                    <option value={50}>Arm's length (50 cm)</option>
                    {distance !== null && ![20, 50].includes(distance) && <option value={distance}>Previous distance ({distance} cm)</option>}
                  </select>
                </div>
                <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <legend style={{ font: '500 15px var(--font-text)', marginBottom: 8, padding: 0 }}>Room</legend>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ENVS.map(([id, label]) => (
                      <label key={id} className="rs-chip" style={{ border: `2px solid ${env === id ? 'var(--primary-edge)' : 'var(--line)'}`, background: env === id ? 'var(--tonal)' : 'var(--ground)', font: '500 15px var(--font-text)', cursor: 'pointer' }}>
                        <input type="radio" name="env" disabled={reassessment && !setupFor} checked={env === id} onChange={() => setEnv(id)} style={{ accentColor: 'var(--primary-edge)', margin: '0 4px 0 0' }} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="rs-stack rs-gap-2">Setup notes (optional)
                  <textarea rows={2} maxLength={500} value={notes} disabled={reassessment && !setupFor} onChange={(event) => setNotes(event.target.value)} style={{ ...select, height: 'auto', padding: 12 }} />
                </label>
                {reassessment && previous.data?.recording_conditions && setupFor && device && (
                  previous.data.recording_conditions.device_label !== device || previous.data.recording_conditions.distance_cm !== distance || previous.data.recording_conditions.environment !== env || (previous.data.recording_conditions.notes ?? '') !== notes.trim()
                ) && <p className="rs-label">Your setup differs from the previous recording. Match it where possible; you can still record with this setup.</p>}
                {create.error && !(create.error instanceof ApiError && create.error.code === 'assessment_in_progress') && <ErrorBanner error={create.error} />}
                <button className="rs-btn rs-btn--wide" type="submit" disabled={!device || create.isPending || (reassessment && !setupFor)} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                  Start the 3 tasks
                </button>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
