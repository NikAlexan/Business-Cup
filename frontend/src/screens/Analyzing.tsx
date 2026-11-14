import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { post, useMutationWithKey } from '../api/api'
import { useJob } from '../api/hooks'
import type { Job } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { Check } from '../components/Icons'
import { FlowHeader } from '../components/FlowHeader'
import { LevelMeter } from '../components/LevelMeter'
import { ErrorBanner } from '../components/ui'
import { useQueryClient } from '@tanstack/react-query'

const STEPS = ['Recording quality checked', 'Pitch, pace and pauses measured', 'Writing observations and your plan']

export default function Analyzing() {
  const [params] = useSearchParams()
  const jobId = params.get('job_id')
  const assessmentId = params.get('assessment_id')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const job = useJob(jobId)
  useRedirectOn401(job.error)
  const retry = useMutationWithKey((_: object, key) => post<Job>(`/jobs/${jobId}/retry`, {}, key))
  const status = job.data?.status

  useEffect(() => {
    if (status === 'completed') {
      void qc.invalidateQueries({ queryKey: ['me'] })
      navigate('/profile/' + (job.data?.result?.assessment_id ?? assessmentId), { replace: true })
    }
    if (status === 'needs_rerecord') navigate('/record?assessment_id=' + assessmentId, { replace: true })
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const done = status === 'processing' ? 1 : 0
  return (
    <div className="rs rs-page">
      <FlowHeader>
        <span className="rs-label">All 3 tasks recorded</span>
      </FlowHeader>
      <main className="rs-wrap" style={{ maxWidth: 640, paddingTop: 24, paddingBottom: 56, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="rs-stack" style={{ alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <div style={{ width: 160, height: 160, borderRadius: '50%', background: 'var(--tonal)', display: 'grid', placeItems: 'center' }}>
            <LevelMeter level={status === 'failed' ? 0 : 0.55} label="Analyzing" />
          </div>
          <span className="rs-badge" style={{ background: 'var(--sky-tint)', color: 'var(--sky)' }}>
            {status === 'failed' ? 'Stopped' : 'Listening to your takes'}
          </span>
          <h1 className="rs-h rs-h1">Building your voice profile</h1>
          <p style={{ margin: 0, color: 'var(--muted)', maxWidth: '34ch' }}>This takes about a minute. You can leave this page — we'll keep working.</p>
        </div>
        {status === 'failed' ? (
          <>
            <ErrorBanner text={job.data?.error?.message ?? 'Analysis failed.'} />
            {job.data?.retryable && (
              <button className="rs-btn rs-btn--wide" type="button" style={{ alignSelf: 'center' }} disabled={retry.isPending} onClick={() => retry.mutate({}, { onSuccess: () => job.refetch() })}>
                Try again
              </button>
            )}
            {retry.error && <ErrorBanner error={retry.error} />}
          </>
        ) : (
          <div className="rs-card rs-stack" style={{ gap: 14 }} aria-live="polite">
            {STEPS.map((s, i) => (
              <div key={s} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {i < done + 1 && i !== done ? (
                  <span style={{ color: 'var(--success)' }}><Check /></span>
                ) : i === done ? (
                  <span className="rs-spin" aria-hidden="true" />
                ) : (
                  <span style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid var(--line)' }} />
                )}
                <span>{s}</span>
              </div>
            ))}
          </div>
        )}
        {job.error && <ErrorBanner error={job.error} onRetry={() => job.refetch()} />}
      </main>
    </div>
  )
}
