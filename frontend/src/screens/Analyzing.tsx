import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { post, useMutationWithKey } from '../api/api'
import { useAssessment, useJob } from '../api/hooks'
import type { Job } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { Check } from '../components/Icons'
import { FlowHeader } from '../components/FlowHeader'
import { LevelMeter } from '../components/LevelMeter'
import { ErrorBanner, Skeleton } from '../components/ui'

const STEPS = ['Recording quality checked', 'Measuring pitch, pace and pauses', 'Preparing listening observations', 'Building your plan']
const CURRENT: Record<string, number> = { measurements: 1, transcription: 1, ai_analysis: 2, plan_generation: 3 }

export default function Analyzing() {
  const [params] = useSearchParams()
  const assessmentId = params.get('assessment_id') ?? undefined
  const assessment = useAssessment(assessmentId)
  const jobId = params.get('job_id') || assessment.data?.job_id
  const job = useJob(jobId)
  const id = job.data?.assessment_id ?? assessmentId
  const mismatch = !!(assessmentId && job.data?.assessment_id && assessmentId !== job.data.assessment_id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  useRedirectOn401(job.error ?? assessment.error)
  const retry = useMutationWithKey((_: object, key) => post(`/jobs/${jobId}/retry`, {}, key))
  const status = job.data?.status

  useEffect(() => {
    if (mismatch) return
    if (status === 'completed' && id) {
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['assessment', id] })
      navigate('/profile/' + id, { replace: true })
    } else if (status === 'needs_rerecord' && id) navigate('/record?assessment_id=' + id, { replace: true })
  }, [status, id, mismatch, navigate, qc])

  useEffect(() => {
    if (!jobId && assessment.data) {
      if (assessment.data.status === 'completed') navigate('/profile/' + assessment.data.id, { replace: true })
      else if (['draft', 'needs_rerecord'].includes(assessment.data.status)) navigate('/record?assessment_id=' + assessment.data.id, { replace: true })
    }
  }, [jobId, assessment.data, navigate])

  const missing = !jobId && (!assessmentId || (!!assessment.data && !['draft', 'needs_rerecord', 'completed'].includes(assessment.data.status)))
  const current = CURRENT[job.data?.stage ?? ''] ?? 1
  return (
    <div className="rs rs-page">
      <FlowHeader back="/"><span className="rs-label">Voice profile analysis</span></FlowHeader>
      <main className="rs-wrap" style={{ maxWidth: 640, paddingTop: 24, paddingBottom: 56, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="rs-stack" style={{ alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <div style={{ width: 160, height: 160, borderRadius: '50%', background: 'var(--tonal)', display: 'grid', placeItems: 'center' }}>
            <LevelMeter level={status === 'failed' || missing || mismatch ? 0 : 0.55} label="Analyzing" />
          </div>
          <h1 className="rs-h rs-h1">{missing ? 'Analysis not found' : status === 'failed' ? 'Analysis paused' : 'Building your voice profile'}</h1>
          <p style={{ margin: 0, color: 'var(--muted)', maxWidth: '36ch' }}>{missing ? 'Your saved results are not affected.' : job.data && !mismatch ? 'Your accepted recordings are saved. You can leave and return to this analysis.' : 'Recovering your saved assessment.'}</p>
        </div>
        {mismatch ? <ErrorBanner text="This link combines different assessments. Open the assessment from your saved progress." />
          : missing ? <><ErrorBanner text="This link does not identify a saved analysis." /><Link className="rs-link" to="/">Return to your practice</Link></>
          : !jobId && assessment.isPending ? <Skeleton height={160} />
          : status === 'failed' ? <>
            <ErrorBanner text={job.data?.error?.message ?? 'Analysis failed.'} />
            <p style={{ margin: 0, textAlign: 'center' }}>{job.data?.retryable ? 'Retry this analysis without uploading them again.' : 'This analysis cannot be retried here.'}</p>
            {job.data?.retryable && <button className="rs-btn rs-btn--wide" type="button" style={{ alignSelf: 'center' }} disabled={retry.isPending} onClick={() => retry.mutate({}, { onSuccess: () => {
              qc.setQueryData<Job>(['job', jobId], (previous) => previous ? { ...previous, status: 'queued', error: null, retryable: false, poll_after_ms: 2000 } : previous)
              void qc.invalidateQueries({ queryKey: ['assessment', id] })
              void job.refetch()
            } })}>Retry analysis</button>}
          </> : jobId && <div className="rs-card rs-stack rs-gap-4" aria-label="Analysis stages">
            <span role="status">{status === 'queued' ? 'Waiting to start analysis' : job.data ? STEPS[current] : 'Loading saved analysis…'}</span>
            {STEPS.map((step, index) => <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'center' }} aria-current={index === current ? 'step' : undefined}>
              {index < current ? <span style={{ color: 'var(--success)' }} aria-label="Completed"><Check /></span>
                : index === current ? <span className="rs-spin" aria-hidden="true" />
                : <span style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid var(--line)' }} />}
              <span>{step}</span>
            </div>)}
          </div>}
        {assessment.error && <ErrorBanner error={assessment.error} onRetry={() => assessment.refetch()} />}
        {job.error && <ErrorBanner error={job.error} onRetry={() => job.refetch()} />}
        {retry.error && <ErrorBanner error={retry.error} />}
      </main>
    </div>
  )
}
