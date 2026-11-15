import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { post, request, useMutationWithKey } from '../api/api'
import { useAssessment, useMe } from '../api/hooks'
import type { AssessmentTask, Recording } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { FlowHeader } from '../components/FlowHeader'
import { RecorderDock } from '../components/RecorderDock'
import { ScriptText } from '../components/ScriptText'
import { useSpeechFollow } from '../lib/follow'
import { ErrorBanner, Skeleton } from '../components/ui'
import { limitFor, useRecorder } from '../lib/recorder'
import { useRecordingCheck } from '../lib/recordingCheck'

const KIND_TITLE: Record<string, string> = {
  control_text: 'Read this passage',
  novel_text: 'Read this unfamiliar passage',
  intonation: 'Read with expression',
}

function TaskRecorder({ task, assessmentId, accepted, onChecked }: { task: AssessmentTask; assessmentId: string; accepted: string[]; onChecked: () => void }) {
  const max = Math.min(task.max_duration_seconds, limitFor('assessment'))
  const r = useRecorder({ maxSeconds: max, accepted })
  const check = useRecordingCheck({ pendingTake: task.pending_take, fields: { purpose: 'assessment', assessment_id: assessmentId, task_id: task.id },
    blob: r.blob, mime: r.mime, onChecked: () => { r.reset(); onChecked() } })
  const follow = useSpeechFollow(task.text, r.state === 'recording')
  const [playT, setPlayT] = useState<number | null>(null)
  useEffect(() => setPlayT(null), [r.state])
  return (
    <>
      <div className="rs-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 28 }}>
        <ScriptText text={task.text} read={r.state === 'recording' ? follow.read : playT !== null ? follow.readAt(playT) : 0} />
        <span className="rs-label">
          Read it at your own pace — there's no time limit to chase.{follow.supported ? ' Words you read turn green.' : ''}
        </span>
      </div>
      {check.job.error && <ErrorBanner error={check.job.error} onRetry={() => check.job.refetch()} />}
      {check.checking && !r.blob && <p role="status">Checking your saved take. You can return here after leaving this page.</p>}
      {check.upload.error && <ErrorBanner error={check.upload.error} onRetry={check.send} />}
      {check.retry.error && <ErrorBanner error={check.retry.error} onRetry={check.send} />}
      {check.checkError && <ErrorBanner text={check.checkError} onRetry={check.canRetryCheck ? check.send : undefined} />}
      {(!check.checking || r.blob) && <RecorderDock
        r={r}
        sending={check.busy}
        onPlayTime={setPlayT}
        onSend={check.send}
      />}
    </>
  )
}

export default function Record() {
  const [params] = useSearchParams()
  const id = params.get('assessment_id') ?? undefined
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useMe()
  const a = useAssessment(id)
  useRedirectOn401(a.error ?? me.error)
  const tasks = [...(a.data?.tasks ?? [])].sort((x, y) => x.order - y.order)
  const current = tasks.find((t) => t.pending_take || t.quality_status !== 'accepted')
  const index = current ? tasks.indexOf(current) : tasks.length
  const rejected = current?.quality_status === 'rejected' ? current : undefined
  const rec = useQuery({
    queryKey: ['recording', rejected?.recording_id],
    queryFn: () => request<Recording>('/recordings/' + rejected!.recording_id),
    enabled: !!rejected?.recording_id,
  })
  const submit = useMutationWithKey((_: object, key) => post<{ job_id: string }>(`/assessments/${id}/submit`, {}, key))

  useEffect(() => {
    const d = a.data
    if (!d) return
    if ((d.status === 'queued' || d.status === 'processing' || d.status === 'failed') && d.job_id) navigate(`/analyzing?job_id=${d.job_id}&assessment_id=${d.id}`, { replace: true })
    if (d.status === 'completed') navigate('/profile/' + d.id, { replace: true })
  }, [a.data, navigate])

  if (!id) return <FlowFrame><ErrorBanner text="This link is missing the assessment." /><Link to="/">Start over</Link></FlowFrame>
  if (a.isPending || me.isPending) return <FlowFrame><Skeleton height={320} /></FlowFrame>
  if (me.error) return <FlowFrame><ErrorBanner error={me.error} onRetry={() => me.refetch()} /></FlowFrame>
  if (a.error || !a.data) return <FlowFrame><ErrorBanner error={a.error} onRetry={() => a.refetch()} /></FlowFrame>

  const progress = Math.round((index / Math.max(1, tasks.length)) * 100)
  return (
    <div className="rs rs-page">
      <FlowHeader back={a.data.kind === 'reassessment' ? '/mic-check?kind=reassessment' + (a.data.demo_override_used ? '&demo=1' : '') : '/mic-check'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="rs-bar" role="progressbar" aria-valuenow={progress} aria-label={`Task ${Math.min(index + 1, tasks.length)} of ${tasks.length}`}>
              <span style={{ width: progress + '%' }} />
            </div>
          </div>
          <span className="rs-label" style={{ whiteSpace: 'nowrap' }}>
            {Math.min(index + 1, tasks.length)} of {tasks.length}
          </span>
        </div>
      </FlowHeader>
      <main className="rs-wrap rs-narrow" style={{ paddingTop: 16, paddingBottom: 48, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {current ? (
          <>
            <div className="rs-stack" style={{ gap: 6 }}>
              <h1 className="rs-h rs-h1">{rejected ? `Let's record task ${index + 1} again` : KIND_TITLE[current.kind] ?? 'Read this passage'}</h1>
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                Task {index + 1} of {tasks.length} · {current.instruction}
              </p>
            </div>
            {a.data.recording_conditions && <aside className="rs-card rs-stack" aria-label="Saved recording setup" style={{ padding: 16, gap: 4 }}>
              <strong>Saved recording setup</strong>
              <span>{a.data.recording_conditions.device_label || 'Microphone not recorded'} · {a.data.recording_conditions.distance_cm ? a.data.recording_conditions.distance_cm + ' cm' : 'Distance not recorded'} · {a.data.recording_conditions.environment.replace(/_/g, ' ')}</span>
              {a.data.recording_conditions.notes && <span>{a.data.recording_conditions.notes}</span>}
            </aside>}
            {rejected && (
              <div className="rs-banner rs-banner--warn" role="status">
                <div className="rs-stack" style={{ gap: 2 }}>
                  {(rec.data?.quality?.issues.length ? rec.data.quality.issues : [{ code: 'x', message: 'This take could not be measured.' }]).map((i) => (
                    <span key={i.code} style={{ fontWeight: 500 }}>{i.message}</span>
                  ))}
                  <span style={{ fontSize: 15, color: 'var(--muted)' }}>
                    {index > 0 ? 'Earlier tasks are saved. ' : ''}Your check-in date won't move.
                  </span>
                </div>
              </div>
            )}
            <TaskRecorder
              key={current.id + (current.recording_id ?? '')}
              task={current}
              assessmentId={id}
              accepted={me.data?.limits.accepted_audio_types ?? []}
              onChecked={() => qc.invalidateQueries({ queryKey: ['assessment', id] })}
            />
          </>
        ) : (
          <div className="rs-stack" style={{ gap: 16, alignItems: 'flex-start' }}>
            <h1 className="rs-h rs-h1">All {tasks.length} tasks recorded</h1>
            <p style={{ margin: 0, color: 'var(--muted)' }}>Next we measure pitch, pace and pauses and build your plan.</p>
            {submit.error && <ErrorBanner error={submit.error} />}
            <button
              className="rs-btn rs-btn--wide"
              type="button"
              disabled={submit.isPending}
              onClick={() => submit.mutate({}, { onSuccess: (r) => navigate(`/analyzing?job_id=${r.job_id}&assessment_id=${id}`) })}
            >
              Build my voice profile
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function FlowFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rs rs-page">
      <FlowHeader back="/">{null}</FlowHeader>
      <main className="rs-wrap rs-narrow" style={{ paddingTop: 24 }}>{children}</main>
    </div>
  )
}
