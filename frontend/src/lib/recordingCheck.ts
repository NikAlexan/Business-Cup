import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { post, useMutationWithKey } from '../api/api'
import { useJob } from '../api/hooks'
import type { PendingTake } from '../api/types'
import { uploadRecording } from './recorder'

type Options = {
  pendingTake?: PendingTake | null
  fields: Record<string, string>
  blob: Blob | null
  mime: string | null
  canRecover?: boolean
  onChecked: (recordingId: string, take?: PendingTake) => void
  onUploaded?: (take: PendingTake) => void
  onUploadStarted?: (key: string) => void
}

// Assessment and daily practice share upload identity, saved-job recovery and bounded retries.
export function useRecordingCheck({ pendingTake, fields, blob, mime, canRecover = true, onChecked, onUploaded, onUploadStarted }: Options) {
  const qc = useQueryClient()
  const [localTake, setTake] = useState<PendingTake | null>(null)
  const [retainedTake, setRetainedTake] = useState<PendingTake | null>(null)
  const handled = useRef(new Set<string>())
  const [checkedRecording, setCheckedRecording] = useState<string | null>(null)
  const [failed, setFailed] = useState<(PendingTake & { retryable: boolean }) | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const retry = useMutationWithKey((id: string, key) => post('/jobs/' + id + '/retry', {}, key))
  const upload = useMutationWithKey((value: { fields: Record<string, string>; blob: Blob; mime: string }, key) => {
    onUploadStarted?.(key)
    return uploadRecording(value.fields, value.blob, value.mime, key)
  })
  const discovered = canRecover && !blob && !upload.isPending && !failed && !checkedRecording && pendingTake && !handled.current.has(pendingTake.recording_id) ? pendingTake : null
  const take = localTake ?? discovered
  const job = useJob(take?.job_id)
  useEffect(() => {
    setCheckedRecording(null); setFailed(null); setCheckError(null); setRetainedTake(null); retry.reset()
  }, [blob]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (take && !handled.current.has(take.recording_id)) { setRetainedTake(take); if (!localTake) { setTake(take); onUploaded?.(take) } }
  }, [take?.recording_id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!take || handled.current.has(take.recording_id)) return
    if (job.data?.status === 'failed') {
      handled.current.add(take.recording_id)
      setFailed({ ...take, retryable: !!job.data.retryable })
      setCheckError(job.data.error?.message ?? 'The recording check failed. Retry the check or record a new take.')
      setTake(null)
    } else if (job.data?.status === 'completed' || job.data?.status === 'needs_rerecord') {
      handled.current.add(take.recording_id)
      setCheckedRecording(job.data.status === 'completed' ? take.recording_id : null)
      onChecked(take.recording_id, take)
      setTake(null)
    }
  }, [job.data?.status, take?.job_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => {
    if (failed?.retryable) {
      retry.mutate(failed.job_id, { onSuccess: () => {
        handled.current.delete(failed.recording_id)
        qc.setQueryData(['job', failed.job_id], { status: 'queued', poll_after_ms: 2000 })
        setTake(failed); setFailed(null); setCheckError(null)
        void qc.invalidateQueries({ queryKey: ['job', failed.job_id] })
      } })
      return
    }
    setCheckError(null)
    if (checkedRecording) { onChecked(checkedRecording, retainedTake ?? undefined); return }
    if (blob && mime) upload.mutate({ fields, blob, mime }, { onSuccess: (data) => {
      const saved = { based_on_attempt_id: fields.based_on_attempt_id ?? null, listening_plan: data.recording.listening_plan ?? null, training_focus: data.recording.training_focus ?? null, recording_id: data.recording.id, job_id: data.job_id, practice_only: fields.practice_only === 'true', status: 'queued' }
      onUploaded?.(saved); setRetainedTake(saved); setTake(saved)
    } })
  }
  return {
    send, job, upload, retry, checkError, checkedRecording, contextTake: take ?? retainedTake,
    canRetryCheck: !retry.isPending && (!!failed?.retryable || !!blob),
    checking: !!take,
    busy: upload.isPending || retry.isPending || !!take,
  }
}
