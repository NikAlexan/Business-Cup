import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, post, useMutationWithKey } from '../api/api'
import { useExercise, useJob, useMe, usePlan, useToday } from '../api/hooks'
import type { Attempt, Lesson, PlanItem } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { FlowHeader } from '../components/FlowHeader'
import { NoteIcon } from '../components/Icons'
import { RecorderDock } from '../components/RecorderDock'
import { ErrorBanner, Skeleton } from '../components/ui'
import { limitFor, uploadRecording, useRecorder } from '../lib/recorder'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const REASON = { exercise_completed: 'Exercise complete', quality_bonus: 'Clean recording bonus' }

type Body = { plan_item_id: string; elapsed_seconds?: number; self_confirmed?: boolean; recording_id?: string }

function TimerCheck({ min, onFinish, busy }: { min: number; onFinish: (s: number) => void; busy: boolean }) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(0)
  useEffect(() => {
    if (!running) return
    started.current = Date.now() - elapsed * 1000
    const t = window.setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250)
    return () => clearInterval(t)
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="rs-dock">
      <div className="rs-stack" style={{ alignItems: 'center', gap: 4 }}>
        <span style={{ font: '600 28px var(--font-display)' }}>
          {clock(elapsed)} <span style={{ color: 'var(--muted)', fontSize: 18 }}>/ {clock(min)}</span>
        </span>
        <span className="rs-label">{elapsed >= min ? 'Time reached — finish when ready' : `Practice for at least ${clock(min)}`}</span>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="rs-btn rs-btn--secondary" type="button" onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : elapsed ? 'Resume' : 'Start timer'}
        </button>
        <button className="rs-btn" type="button" disabled={!elapsed || busy} onClick={() => (setRunning(false), onFinish(Math.round(elapsed)))}>
          Finish
        </button>
      </div>
    </div>
  )
}

function SelfCheck({ onFinish, busy }: { onFinish: () => void; busy: boolean }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="rs-dock" style={{ flexDirection: 'column', gap: 14 }}>
      <label style={{ display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--primary-edge)' }} />
        I practiced this exercise
      </label>
      <button className="rs-btn" type="button" disabled={!ok || busy} onClick={onFinish}>
        Complete
      </button>
    </div>
  )
}

function RecordCheck({ item, accepted, onRecorded, busy }: { item: PlanItem; accepted: string[]; onRecorded: (id: string) => void; busy: boolean }) {
  const max = Math.min(item.task.verification.max_recording_seconds ?? 90, limitFor('exercise'))
  const r = useRecorder({ maxSeconds: max, accepted })
  const [job, setJob] = useState<{ id: string; rec: string } | null>(null)
  const j = useJob(job?.id)
  const upload = useMutationWithKey((v: { blob: Blob; mime: string }, key) => uploadRecording({ purpose: 'exercise', plan_item_id: item.id }, v.blob, v.mime, key))
  useEffect(() => {
    const s = j.data?.status
    if (job && (s === 'completed' || s === 'needs_rerecord')) {
      onRecorded(job.rec)
      setJob(null)
      r.reset()
    }
  }, [j.data?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => r.blob && r.mime && upload.mutate({ blob: r.blob, mime: r.mime }, { onSuccess: (d) => setJob({ id: d.job_id, rec: d.recording.id }) })
  return (
    <>
      {upload.error && <ErrorBanner error={upload.error} onRetry={send} />}
      {j.data?.status === 'failed' && <ErrorBanner text={j.data.error?.message ?? 'The recording check failed.'} />}
      <RecorderDock r={r} max={max} sending={busy || upload.isPending || !!job} onSend={send} sendLabel="Check my take" />
    </>
  )
}

function locate(id: string, lessons: (Lesson | null | undefined)[]) {
  for (const l of lessons) {
    const i = l?.items.findIndex((x) => x.id === id) ?? -1
    if (l && i >= 0) return { lesson: l, item: l.items[i], index: i }
  }
  return null
}

export default function Exercise() {
  const { planItemId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const today = useToday()
  const plan = usePlan()
  const me = useMe()
  useRedirectOn401(today.error)
  const found = locate(planItemId, [today.data?.lesson, ...(plan.data?.lessons ?? [])])
  const ex = useExercise(found?.item.exercise_id)
  const [result, setResult] = useState<Attempt | null>(null)
  const attempt = useMutationWithKey((b: Body, key) => post<Attempt>('/exercise-attempts', b, key))

  useEffect(() => setResult(null), [planItemId])

  if (today.isPending || plan.isPending) return <Frame><Skeleton height={360} /></Frame>
  if (!found) return <Frame><ErrorBanner text="This exercise is not in your plan." /><Link className="rs-link" to="/today">Back to today</Link></Frame>
  const { lesson, item, index } = found
  const nextItem = lesson.items.find((x, i) => i !== index && x.status !== 'completed')
  const goNext = () => navigate(nextItem ? '/exercise/' + nextItem.id : '/done/' + lesson.id)
  const v = item.task.verification
  const submit = (b: Omit<Body, 'plan_item_id'>) =>
    attempt.mutate(
      { plan_item_id: item.id, ...b },
      {
        onSuccess: (a) => {
          setResult(a)
          void qc.invalidateQueries({ queryKey: ['today'] })
          void qc.invalidateQueries({ queryKey: ['plan'] })
          void qc.invalidateQueries({ queryKey: ['me'] })
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'plan_item_already_completed') goNext()
        },
      },
    )
  const passed = result?.status === 'passed' || (item.status === 'completed' && !result)
  const progress = Math.round(((lesson.items.filter((x) => x.status === 'completed').length) / lesson.items.length) * 100)

  return (
    <div className="rs rs-page">
      <FlowHeader back="/today">
        <div className="rs-bar" role="progressbar" aria-valuenow={progress} aria-label={`Exercise ${index + 1} of ${lesson.items.length}`}>
          <span style={{ width: progress + '%' }} />
        </div>
      </FlowHeader>
      <main className="rs-wrap" style={{ paddingTop: 20, paddingBottom: 48 }}>
        <div className="rs-cols" style={{ gridTemplateColumns: 'minmax(0, .8fr) minmax(0, 1.2fr)' }}>
          <div className="rs-stack" style={{ gap: 12 }}>
            <h1 className="rs-h rs-h1">{item.title}</h1>
            <div className="rs-meta">
              <span className="rs-opt__icon" style={{ width: 34, height: 34, fontSize: 12, background: 'var(--primary)', color: 'var(--primary-ink)' }}>{item.exercise_id}</span>
              <span>{Math.max(1, Math.round(item.estimated_duration_seconds / 60))} min</span>
              <span>{item.difficulty ?? ''}</span>
              <span>+{item.notes_available} notes</span>
            </div>
            <p style={{ margin: 0, color: 'var(--muted)' }}>{ex.data?.instruction ?? item.task.instruction}</p>
            {item.reason && <p style={{ margin: 0, fontSize: 15 }}>{item.reason}</p>}
            {v.target_wpm && (
              <div>
                <span className="rs-badge" style={{ background: 'var(--sky-tint)', color: 'var(--sky)' }}>
                  Target {v.target_wpm.min}–{v.target_wpm.max} wpm
                </span>
              </div>
            )}
          </div>
          <div className="rs-stack" style={{ gap: 16 }}>
            <div className="rs-card" style={{ padding: 28 }}>
              <p className="rs-script rs-script--big">{item.task.text}</p>
            </div>
            {passed ? (
              <div className="rs-card rs-stack" style={{ gap: 12, padding: 24, background: 'var(--success-tint)' }} role="status">
                <h2 className="rs-h" style={{ fontSize: 22 }}>{result ? 'Nice work!' : 'Already done'}</h2>
                {result?.reward.parts.map((p) => (
                  <div key={p.reason} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <NoteIcon /> <strong>+{p.notes}</strong> {REASON[p.reason]}
                  </div>
                ))}
                <button className="rs-btn rs-btn--wide" type="button" onClick={goNext} style={{ alignSelf: 'flex-start' }}>
                  {nextItem ? 'Next exercise' : 'Finish session'}
                </button>
              </div>
            ) : (
              <>
                {result?.status === 'needs_retry' && (
                  <div className="rs-banner rs-banner--warn" role="status">
                    <div className="rs-stack" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 500 }}>{result.feedback.summary}</span>
                      {result.feedback.issues.map((i) => (
                        <span key={i.code} style={{ fontSize: 15 }}>{i.message}</span>
                      ))}
                    </div>
                  </div>
                )}
                {attempt.error && !(attempt.error instanceof ApiError && attempt.error.code === 'plan_item_already_completed') && <ErrorBanner error={attempt.error} />}
                {v.type === 'timer' && <TimerCheck key={result?.id} min={v.min_elapsed_seconds ?? 30} busy={attempt.isPending} onFinish={(s) => submit({ elapsed_seconds: s })} />}
                {v.type === 'self_confirmation' && <SelfCheck busy={attempt.isPending} onFinish={() => submit({ self_confirmed: true })} />}
                {v.type === 'recording' && me.data && <RecordCheck item={item} accepted={me.data.limits.accepted_audio_types} busy={attempt.isPending} onRecorded={(id) => submit({ recording_id: id })} />}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rs rs-page">
      <FlowHeader back="/today">{null}</FlowHeader>
      <main className="rs-wrap rs-narrow" style={{ paddingTop: 24 }}>{children}</main>
    </div>
  )
}
