import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, post, useMutationWithKey } from '../api/api'
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
] as const
const select = { height: 48, borderRadius: 14, border: '2px solid var(--line)', padding: '0 14px', font: '400 16px var(--font-text)', background: 'var(--ground)', color: 'var(--ink)' }

export default function MicCheck() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reassessment = params.get('kind') === 'reassessment'
  const [error, setError] = useState<MicErrorKind | null>(null)
  const [{ level, status }, setLevel] = useState<Level>({ level: 0, status: 'waiting' })
  const [device, setDevice] = useState('')
  const [distance, setDistance] = useState(20)
  const [env, setEnv] = useState<string>('quiet_room')
  const requestRef = useRef<AbortController | null>(null)
  const stopRef = useRef<() => void>(() => {})

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
  useRedirectOn401(create.error)
  const go = () =>
    create.mutate(
      {
        kind: reassessment ? 'reassessment' : 'initial',
        demo_override: reassessment && params.get('demo') === '1',
        recording_conditions: { device_label: device || null, distance_cm: distance, environment: env },
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
              <form className="rs-stack" style={{ gap: 16 }} aria-label="Recording setup" onSubmit={(e) => (e.preventDefault(), go())}>
                <div className="rs-stack" style={{ gap: 4 }}>
                  <h2 className="rs-h" style={{ fontSize: 20 }}>Your recording setup</h2>
                  <p style={{ margin: 0, fontSize: 15, color: 'var(--muted)' }}>
                    {reassessment ? 'Match the setup of your first recording so the numbers compare.' : 'We save it with your baseline and ask you to match it on day 14.'}
                  </p>
                </div>
                <div className="rs-stack" style={{ gap: 6 }}>
                  <span style={{ font: '500 15px var(--font-text)' }}>Microphone</span>
                  <span className="rs-label">{device || '—'}</span>
                </div>
                <div className="rs-stack" style={{ gap: 6 }}>
                  <label htmlFor="dist" style={{ font: '500 15px var(--font-text)' }}>Distance to the mic</label>
                  <select id="dist" style={select} value={distance} onChange={(e) => setDistance(+e.target.value)}>
                    <option value={20}>About a hand away (20 cm)</option>
                    <option value={50}>Arm's length (50 cm)</option>
                  </select>
                </div>
                <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <legend style={{ font: '500 15px var(--font-text)', marginBottom: 8, padding: 0 }}>Room</legend>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ENVS.map(([id, label]) => (
                      <label key={id} className="rs-chip" style={{ border: `2px solid ${env === id ? 'var(--primary-edge)' : 'var(--line)'}`, background: env === id ? 'var(--tonal)' : 'var(--ground)', font: '500 15px var(--font-text)', cursor: 'pointer' }}>
                        <input type="radio" name="env" checked={env === id} onChange={() => setEnv(id)} style={{ accentColor: 'var(--primary-edge)', margin: '0 4px 0 0' }} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {create.error && !(create.error instanceof ApiError && create.error.code === 'assessment_in_progress') && <ErrorBanner error={create.error} />}
                <button className="rs-btn rs-btn--wide" type="submit" disabled={!device || create.isPending} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
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
