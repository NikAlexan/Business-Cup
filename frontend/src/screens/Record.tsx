import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { post, request, useMutationWithKey } from '../api/api'
import { useAssessment, useJob, useMe } from '../api/hooks'
import type { AssessmentTask, Recording } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { FlowHeader } from '../components/FlowHeader'
import { RecorderDock } from '../components/RecorderDock'
import { ErrorBanner, Skeleton } from '../components/ui'
import { limitFor, uploadRecording, useRecorder } from '../lib/recorder'

const KIND_TITLE: Record<string, string> = {
  control_text: 'Read this passage',
  novel_text: 'Read this unfamiliar passage',
  intonation: 'Read with expression',
}

function TaskRecorder({ task, assessmentId, accepted, onChecked }: { task: AssessmentTask; assessmentId: string; accepted: string[]; onChecked: () => void }) {
  const max = Math.min(task.max_duration_seconds, limitFor('assessment'))
  const r = useRecorder({ maxSeconds: max, accepted })
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId)
  const upload = useMutationWithKey((v: { blob: Blob; mime: string }, key) =>
    uploadRecording({ purpose: 'assessment', assessment_id: assessmentId, task_id: task.id }, v.blob, v.mime, key),
  )
  useEffect(() => {
    const s = job.data?.status
    if (s === 'completed' || s === 'needs_rerecord' || s === 'failed') {
      setJobId(null)
      r.reset()
      onChecked()
    }
  }, [job.data?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const busy = upload.isPending || !!jobId
  return (
    <>
      {upload.error && <ErrorBanner error={upload.error} onRetry={() => r.blob && r.mime && upload.mutate({ blob: r.blob, mime: r.mime })} />}
      <RecorderDock
        r={r}
       
        sending={busy}
        onSend={() => r.blob && r.mime && upload.mutate({ blob: r.blob, mime: r.mime }, { onSuccess: (d) => setJobId(d.job_id) })}
      />
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
  const current = tasks.find((t) => t.quality_status !== 'accepted')
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
    if ((d.status === 'queued' || d.status === 'processing') && d.job_id) navigate(`/analyzing?job_id=${d.job_id}&assessment_id=${d.id}`, { replace: true })
    if (d.status === 'completed') navigate('/profile/' + d.id, { replace: true })
  }, [a.data, navigate])

  if (!id) return <FlowFrame><ErrorBanner text="This link is missing the assessment." /><Link to="/">Start over</Link></FlowFrame>
  if (a.isPending || me.isPending) return <FlowFrame><Skeleton height={320} /></FlowFrame>
  if (a.error || !a.data) return <FlowFrame><ErrorBanner error={a.error} onRetry={() => a.refetch()} /></FlowFrame>

  const progress = Math.round((index / Math.max(1, tasks.length)) * 100)
  return (
    <div className="rs rs-page">
      <FlowHeader back="/mic-check">
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
            <div className="rs-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 28 }}>
              <p className="rs-script rs-script--big">{current.text}</p>
              <span className="rs-label">Read it at your own pace — there's no time limit to chase. We measure how you read on your own.</span>
            </div>
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
