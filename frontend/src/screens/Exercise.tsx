import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, post, useMutationWithKey } from '../api/api'
import { useAttempt, useJob, useMe, usePlan, useToday } from '../api/hooks'
import type { Attempt, Lesson, PlanItem } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { FlowHeader } from '../components/FlowHeader'
import { NoteIcon } from '../components/Icons'
import { RecorderDock } from '../components/RecorderDock'
import { ScriptText } from '../components/ScriptText'
import { useSpeechFollow } from '../lib/follow'
import { ErrorBanner, Skeleton } from '../components/ui'
import { uploadRecording, useRecorder } from '../lib/recorder'

import { formatEstimate } from '../lib/format'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const REASON = { exercise_completed: 'Exercise complete', quality_bonus: 'Clean recording bonus' }

type Body = { plan_item_id: string; elapsed_seconds?: number; self_confirmed?: boolean; recording_id?: string }

function TimerCheck({ text, min, onFinish, busy }: { text: string; min: number; onFinish: (s: number) => void; busy: boolean }) {
  const [running, setRunning] = useState(false)
  const follow = useSpeechFollow(text, running) // ponytail: pause/resume restarts the highlight
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(0)
  useEffect(() => {
    if (!running) return
    started.current = Date.now() - elapsed * 1000
    const t = window.setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250)
    return () => clearInterval(t)
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
    <div className="rs-card" style={{ padding: 28 }}>
      <ScriptText text={text} read={follow.read} />
    </div>
    <div className="rs-dock">
      <div className="rs-stack" style={{ alignItems: 'center', gap: 4 }}>
        <span style={{ font: '600 28px var(--font-display)' }}>
          {clock(elapsed)} <span style={{ color: 'var(--muted)', fontSize: 18 }}>/ {clock(min)}</span>
        </span>
        <span className="rs-label">Suggested practice time · finish when you have completed the steps</span>
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
    </>
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

function RecordCheck({ item, accepted, serverLimit, onRecorded, busy }: { item: PlanItem; accepted: string[]; serverLimit: number; onRecorded: (id: string) => void; busy: boolean }) {
  const max = Math.min(item.task.verification.max_recording_seconds ?? 90, serverLimit)
  const r = useRecorder({ maxSeconds: max, accepted })
  const [job, setJob] = useState<{ id: string; rec: string } | null>(null)
  const j = useJob(job?.id)
  const [checkedRecording, setCheckedRecording] = useState<string | null>(null)
  useEffect(() => setCheckedRecording(null), [r.blob])
  const [checkError, setCheckError] = useState<string | null>(null)
  const upload = useMutationWithKey((v: { blob: Blob; mime: string }, key) => uploadRecording({ purpose: 'exercise', plan_item_id: item.id }, v.blob, v.mime, key))
  useEffect(() => {
    const s = j.data?.status
    if (s === 'failed') {
      setCheckError(j.data?.error?.message ?? 'The recording check failed. Please send your take again.')
      setJob(null)
    }
    if (job && (s === 'completed' || s === 'needs_rerecord')) {
      setCheckedRecording(s === 'completed' ? job.rec : null)
      onRecorded(job.rec)
      setJob(null)
    }
  }, [j.data?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const recording = r.state === 'recording'
  const spokenText = Array.from({ length: item.task.repetitions ?? 1 }, () => item.task.text).join('\n\n')
  const follow = useSpeechFollow(spokenText, recording)
  const [playT, setPlayT] = useState<number | null>(null)
  useEffect(() => setPlayT(null), [r.state])
  const wpm = item.task.verification.target_wpm
  const pacer = wpm && recording ? (r.seconds * (wpm.min + wpm.max)) / 2 / 60 : undefined
  const send = () => {
    setCheckError(null)
    if (checkedRecording) { onRecorded(checkedRecording); return }
    if (r.blob && r.mime) upload.mutate({ blob: r.blob, mime: r.mime }, { onSuccess: (d) => setJob({ id: d.job_id, rec: d.recording.id }) })
  }
  return (
    <>
      <div className="rs-card rs-stack" style={{ padding: 28, gap: 12 }}>
        <ScriptText text={spokenText} read={recording ? follow.read : playT !== null ? follow.readAt(playT) : 0} pacer={pacer} />
        {recording && (follow.supported || pacer !== undefined) && (
          <span className="rs-label">
            {[follow.supported && 'Read words turn green', pacer !== undefined && 'the blue mark moves at the target pace'].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {upload.error && <ErrorBanner error={upload.error} onRetry={send} />}
      {checkError && <ErrorBanner text={checkError} onRetry={send} />}
      <RecorderDock r={r} sending={busy || upload.isPending || !!job} onSend={send} sendLabel="Check my take" onPlayTime={setPlayT} />
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
  const [localResult, setResult] = useState<Attempt | null>(null)
  const savedAttempt = useAttempt(found?.item.latest_attempt_id)
  const result = localResult ?? savedAttempt.data ?? null
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

              <span>About {formatEstimate(item.estimated_duration_seconds)}</span>
              <span>{item.difficulty ?? ''}</span>
              <span>+{item.notes_available} notes</span>
            </div>
            {item.variant_label && <h2 className="rs-h" style={{ fontSize: 22 }}>{item.variant_label}</h2>}
            <p style={{ margin: 0, color: 'var(--muted)' }}>{item.task.instruction}</p>
            {item.task.timing?.includes_listening && <p className="rs-label">Session estimate includes recording, listening back, and reflection.</p>}
            {item.task.timing?.expected_recording_seconds && <p className="rs-label">Typical take: {item.task.timing.expected_recording_seconds.min}–{item.task.timing.expected_recording_seconds.max} sec. Finish at your own pace.</p>}
            {item.task.reflection_prompt && <p style={{ margin: 0 }}><strong>Listen for:</strong> {item.task.reflection_prompt}</p>}
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
            {(v.type === 'self_confirmation' || passed) && (
              <div className="rs-card" style={{ padding: 28 }}>
                {item.task.steps?.length ? <ol>{item.task.steps.map((step, n) => <li key={n}>{step}</li>)}</ol> : <ScriptText text={item.task.text} />}
              </div>
            )}
            {passed ? (
              <div className="rs-card rs-stack" style={{ gap: 12, padding: 24, background: 'var(--success-tint)' }} role="status">
                <h2 className="rs-h" style={{ fontSize: 22 }}>{result ? 'Practice complete' : 'Already done'}</h2>
                {result && <p style={{ margin: 0 }}>{result.feedback.summary}</p>}
                {typeof result?.feedback.metrics?.speaking_rate_wpm?.value === 'number' && <p style={{ margin: 0 }}>Measured pace: {Math.round(result.feedback.metrics.speaking_rate_wpm.value)} words/min</p>}
                {savedAttempt.isPending && item.latest_attempt_id && !localResult && <p>Loading your saved feedback…</p>}
                {savedAttempt.error && !localResult && <ErrorBanner error={savedAttempt.error} onRetry={() => savedAttempt.refetch()} />}
                {result?.feedback.coaching?.map((tip) => <p key={tip.code} style={{ margin: 0 }}>{tip.message}</p>)}
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
                {v.type === 'timer' && <TimerCheck key={result?.id} text={item.task.text} min={v.min_elapsed_seconds ?? 30} busy={attempt.isPending} onFinish={(s) => submit({ elapsed_seconds: s })} />}
                {v.type === 'self_confirmation' && <SelfCheck key={item.id} busy={attempt.isPending} onFinish={() => submit({ self_confirmed: true })} />}
                {v.type === 'recording' && me.data && <RecordCheck key={item.id} item={item} serverLimit={me.data.limits.max_recording_seconds} accepted={me.data.limits.accepted_audio_types} busy={attempt.isPending} onRecorded={(id) => submit({ recording_id: id })} />}
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
