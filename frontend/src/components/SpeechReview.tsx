import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { post, useMutationWithKey } from '../api/api'
import { useAttempt, useJob, useMe } from '../api/hooks'
import type { Attempt } from '../api/types'
import { ErrorBanner } from './ui'
import { listeningDecision, nextListeningIntent } from '../lib/listeningDecision'

export function SpeechReview({ take, onHear }: { take: Attempt; onHear: (seconds: number) => void }) {
  const qc = useQueryClient()
  const live = useAttempt(take.id)
  // A completed review cannot be requeued; an older in-flight GET must not hide its saved report.
  const review = take.speech_review?.report && !live.data?.speech_review?.report ? take.speech_review : live.data?.speech_review ?? take.speech_review
  const me = useMe()
  const job = useJob(review?.job_id)
  const requestReview = useMutationWithKey((_: null, key) => post<Attempt>('/exercise-attempts/' + take.id + '/review', {}, key))
  const retry = useMutationWithKey((id: string, key) => post('/jobs/' + id + '/retry', {}, key))
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['attempt', take.id] })
    void qc.invalidateQueries({ queryKey: ['attempt-history', take.plan_item_id] })
  }
  useEffect(() => {
    if (job.data?.status === 'completed' || job.data?.status === 'failed') refresh()
  }, [job.data?.status, review?.job_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const pending = review?.status === 'queued' || review?.status === 'processing'
  const report = review?.report
  const decision = listeningDecision(nextListeningIntent(take, live.data) ?? report?.action_intent ?? undefined)
  return <section className="rs-stack" aria-label="Speech coaching" style={{ gap: 10 }}>
    <h3 className="rs-h" style={{ fontSize: 20 }}>Speech coaching</h3>
    {pending && <p role="status">Your take is saved. Speech coaching is being prepared; you can continue and return later.</p>}
    {live.error && <ErrorBanner error={live.error} onRetry={() => live.refetch()} />}
    {job.error && <ErrorBanner error={job.error} onRetry={() => job.refetch()} />}
    {report && <>
      <span className="rs-label">AI impressions need your listening check. They do not score this take.</span>
      <p style={{ margin: 0 }}><strong>AI impression:</strong> {report.summary}</p>
      {report.observation && <div>
        <span className="rs-label">Listening hypothesis</span>
        <p>{report.observation.text}</p>
        <button className="rs-link" type="button" onClick={() => onHear(report.observation!.evidence.start_seconds)}>Listen to “{report.observation.evidence.quote}”</button>
        {report.observation.evidence.note && <p className="rs-label">{report.observation.evidence.note}</p>}
      </div>}
      <p><strong>{decision ? 'Your listening step:' : 'Optional idea:'}</strong> {decision?.step ?? report.model_next_step ?? report.next_step}</p>
      <p><strong>Ask yourself:</strong> {decision?.question ?? report.model_listening_question ?? report.listening_question}</p>
      {report.limitations.map((note, index) => <p className="rs-label" key={index}>{note}</p>)}
    </>}
    {!pending && !report && <p style={{ margin: 0 }}>{review?.status === 'failed'
      ? 'Speech coaching could not finish. Your take and completion are saved.'
      : review?.reason === 'transcription_unverified'
      ? 'Speech coaching could not be grounded in reliable word timings for this take. Listen back using the exercise prompt.'
      : review?.reason?.includes('daily_limit')
        ? 'The daily speech-coaching limit has been reached. Your practice and audio are saved.'
        : 'Speech coaching is unavailable for this take. You can still listen and save a reflection.'}</p>}
    {(!review || (review.status === 'unavailable' && review.reason !== 'transcription_unverified')) && me.data?.capabilities?.exercise_coaching && <button className="rs-btn rs-btn--secondary" type="button" disabled={requestReview.isPending} onClick={() => requestReview.mutate(null, { onSuccess: (updated) => { qc.setQueryData(['attempt', take.id], updated); refresh() } })}>Request speech coaching</button>}
    {review?.status === 'failed' && job.data?.retryable && <button className="rs-btn rs-btn--secondary" type="button" disabled={retry.isPending} onClick={() => retry.mutate(review.job_id!, { onSuccess: () => { qc.setQueryData(['job', review.job_id], { status: 'queued', poll_after_ms: 2000 }); refresh(); void job.refetch() } })}>Retry speech coaching</button>}
    {requestReview.error && <ErrorBanner error={requestReview.error} />}
    {retry.error && <ErrorBanner error={retry.error} />}
  </section>
}
