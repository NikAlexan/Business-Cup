import { AudioPlayer } from '../components/AudioPlayer'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, post, request, useMutationWithKey } from '../api/api'
import { useAttempt, useAttemptHistory, useMe, usePlanItem, useRecording } from '../api/hooks'
import type { Attempt, ListeningBoundary, ListeningExampleData, ListeningPlan, PendingTake, PlanItem, PlanItemState, TrainingFocus } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { DemoNotice } from '../components/DemoNotice'
import { FlowHeader } from '../components/FlowHeader'
import { NoteIcon } from '../components/Icons'
import { RecorderDock } from '../components/RecorderDock'
import { TakeReflection } from '../components/TakeReflection'
import { TakeComparison } from '../components/TakeComparison'
import { FocusCheck, StoryFocus } from '../components/StoryFocus'
import { SpeechReview } from '../components/SpeechReview'
import { ScriptText } from '../components/ScriptText'
import { ListeningExample, PlannedBoundary } from '../components/ListeningExample'
import { useSpeechFollow } from '../lib/follow'
import { ErrorBanner, Skeleton } from '../components/ui'
import { useRecorder } from '../lib/recorder'
import { useRecordingCheck } from '../lib/recordingCheck'
import { listeningDecision, nextListeningIntent } from '../lib/listeningDecision'
import { reconcileAttempt } from '../lib/attemptView'
import { forgetCancellation, rememberCancellation, useCancellationIntent, type CancellationIntent } from '../lib/cancellationIntent'

import { formatEstimate } from '../lib/format'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const REASON = { exercise_completed: 'Exercise complete', quality_bonus: 'Clean recording bonus' }

type Body = { plan_item_id: string; practice_only?: boolean; based_on_attempt_id?: string; elapsed_seconds?: number; self_confirmed?: boolean; recording_id?: string }

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

function RecordCheck({ item, accepted, serverLimit, onRecorded, onUploaded, pendingTake, busy, practiceOnly, basedOn, onUploadStarted, trainingFocus, listeningExample, listeningBoundaries = [], listeningPlan }: { item: PlanItem; accepted: string[]; serverLimit: number; onRecorded: (id: string, take?: PendingTake) => void; busy: boolean; practiceOnly: boolean; basedOn?: string; pendingTake: PendingTake | null; onUploaded: (take: PendingTake) => void; onUploadStarted?: (key: string) => void; trainingFocus?: TrainingFocus | null; listeningExample?: ListeningExampleData | null; listeningBoundaries?: ListeningBoundary[]; listeningPlan?: ListeningPlan | null }) {
  const qc = useQueryClient()
  const [savingListeningPlan, setSavingListeningPlan] = useState(false)
  const max = Math.min(item.task.verification.max_recording_seconds ?? 90, serverLimit)
  const r = useRecorder({ maxSeconds: max, accepted })
  const [draftFocus, setDraftFocus] = useState<TrainingFocus | null | undefined>(() => pendingTake ? pendingTake.training_focus ?? null : undefined)
  const localFocus = draftFocus === undefined ? trainingFocus : draftFocus
  const [draftPlan, setDraftPlan] = useState<ListeningPlan | null | undefined>(() => pendingTake ? pendingTake.listening_plan ?? null : undefined)
  const [draftSource, setDraftSource] = useState<string | null | undefined>(undefined)
  const localSource = r.state !== 'idle' && draftSource !== undefined ? draftSource : basedOn
  const localPlan = r.state !== 'idle' && draftPlan !== undefined ? draftPlan : listeningPlan
  const dockRecorder = { ...r, start: () => { if (savingListeningPlan) return Promise.resolve(); setDraftSource(check.contextTake ? check.contextTake.based_on_attempt_id ?? null : basedOn ?? null); setDraftFocus(focus ?? null); setDraftPlan(plan ?? null); return r.start() }, reset: () => { setDraftSource(undefined); setDraftFocus(undefined); setDraftPlan(undefined); r.reset() } }
  const check = useRecordingCheck({ pendingTake, blob: r.blob, mime: r.mime, canRecover: r.state === 'idle' && !busy, onChecked: onRecorded, onUploaded, onUploadStarted,
    fields: { purpose: 'exercise', plan_item_id: item.id, ...(practiceOnly ? { practice_only: 'true' } : {}), ...(localSource ? { based_on_attempt_id: localSource } : {}), ...(localFocus ? { training_focus_id: localFocus.id } : {}), ...(localPlan ? { listening_plan_id: localPlan.id } : {}) } })
  const context = r.state === 'idle' || check.checking ? check.contextTake : null
  const focus = context ? context.training_focus ?? null : localFocus
  const plan = context ? context.listening_plan ?? null : localPlan
  const recording = r.state === 'recording'
  const spokenText = Array.from({ length: item.task.repetitions ?? 1 }, () => item.task.text).join('\n\n')
  const follow = useSpeechFollow(spokenText, recording)
  const [playT, setPlayT] = useState<number | null>(null)
  useEffect(() => setPlayT(null), [r.state])
  const wpm = item.task.verification.target_wpm
  const pacer = wpm && recording ? (r.seconds * (wpm.min + wpm.max)) / 2 / 60 : undefined
  return (
    <>
      {focus && <StoryFocus focus={focus} recording={recording || r.state === 'requesting'} />}
      {listeningExample && <ListeningExample key={listeningExample.id} itemId={item.id} example={plan?.example ?? listeningExample} boundaries={listeningBoundaries} plan={plan} locked={r.state !== 'idle' || !!check.contextTake || busy} onBusy={setSavingListeningPlan} onSaved={async () => {
        await qc.cancelQueries({ queryKey: ['plan-item', item.id], exact: true })
        const state = await request<PlanItemState>('/plan-items/' + item.id)
        qc.setQueryData(['plan-item', item.id], state)
        return state.listening_plan ?? null
      }} />}
      <div className="rs-card rs-stack" style={{ padding: 28, gap: 12 }}>
        <ScriptText text={spokenText} read={recording ? follow.read : playT !== null ? follow.readAt(playT) : 0} pacer={pacer} />
        {recording && (follow.supported || pacer !== undefined) && (
          <span className="rs-label">
            {[follow.supported && 'Read words turn green', pacer !== undefined && 'the blue mark moves at the target pace'].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {check.job.error && <ErrorBanner error={check.job.error} onRetry={() => check.job.refetch()} />}
      {check.checking && !r.blob && <p role="status">Checking your saved take. You can return here after leaving this page.</p>}
      {check.upload.error && <ErrorBanner error={check.upload.error} onRetry={check.send} />}
      {check.retry.error && <ErrorBanner error={check.retry.error} onRetry={check.send} />}
      {check.checkError && <ErrorBanner text={check.checkError} onRetry={check.canRetryCheck ? check.send : undefined} />}
      {check.checkedRecording && !r.blob ? <div className="rs-card rs-stack" style={{ padding: 24, gap: 12 }}>
        <AudioPlayer aria-label="Your checked take" src={'/api/v1/recordings/' + check.checkedRecording + '/audio'} />
        <button className="rs-btn" type="button" disabled={busy} onClick={check.send}>{busy ? 'Saving…' : 'Save checked take'}</button>
      </div> : !check.checking || r.blob ? <RecorderDock r={dockRecorder} startDisabled={savingListeningPlan} sending={busy || check.busy} onSend={check.send} sendLabel="Check my take" onPlayTime={setPlayT} /> : null}
    </>
  )
}

export default function Exercise() {
  const { planItemId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const itemState = usePlanItem(planItemId)
  const me = useMe()
  const cancellation = useCancellationIntent(me.data?.guest_id, planItemId)
  useRedirectOn401(itemState.error ?? me.error)
  const found = itemState.data ? { lesson: itemState.data.lesson, item: itemState.data.item, index: itemState.data.item_index } : null
  const [localResult, setResult] = useState<Attempt | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const canceling = useRef(false)
  const uploadKey = useRef<string | null>(null)
  const cancellationTried = useRef<string | null>(null)
  const currentItem = useRef(planItemId)
  currentItem.current = planItemId
  const [repeatSource, setRepeatSource] = useState<string | null>(null)
  const [repeatFor, setRepeatFor] = useState<string | null>(null)
  const [localPending, setLocalPending] = useState<{ itemId: string; take: PendingTake } | null>(null)
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set())
  const candidate = localPending?.itemId === planItemId ? localPending.take : itemState.data?.pending_take ?? null
  const pendingTake = candidate && !ignored.has(candidate.recording_id) ? candidate : null
  const practicingAgain = repeatFor === planItemId || !!pendingTake?.practice_only || !!cancellation.intent
  const basedOn = pendingTake?.based_on_attempt_id ?? repeatSource ?? undefined
  const latestLocal = localResult?.plan_item_id === planItemId ? localResult : null
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const completed = found?.item.status === 'completed' || latestLocal?.status === 'passed'
  const history = useAttemptHistory(completed ? found?.item.id : undefined)
  const takes = history.data?.pages.flatMap((page) => page.items) ?? []
  const selected = selectedId ? takes.find((take) => take.id === selectedId) : takes[0]
  const preferredTake = latestLocal ?? selected
  const savedAttempt = useAttempt(preferredTake?.id ?? selectedId ?? found?.item.latest_attempt_id)
  const result = reconcileAttempt(preferredTake, savedAttempt.data)
  const viewedTake = useRef<{ itemId: string; attemptId: string | null }>({ itemId: planItemId, attemptId: null })
  viewedTake.current = { itemId: planItemId, attemptId: practicingAgain ? null : result?.id ?? null }
  const updateViewedTake = (updated: Attempt) => {
    const current = reconcileAttempt(qc.getQueryData<Attempt>(['attempt', updated.id]), updated, true) ?? updated
    qc.setQueryData(['attempt', updated.id], current)
    if (viewedTake.current.itemId === updated.plan_item_id && viewedTake.current.attemptId === updated.id) setResult((shown) => reconcileAttempt(shown?.id === current.id ? shown : null, current, true))
    void qc.invalidateQueries({ queryKey: ['attempt-history', updated.plan_item_id] })
  }
  const timingDecision = result ? listeningDecision(nextListeningIntent(result)) : null
  const timingIdea = timingDecision?.step ?? result?.feedback.next_step
  const savedRecording = useRecording(result?.recording_id)
  const dismiss = useMutation({ mutationFn: (id: string) => request('/recordings/' + id + '/dismiss', { method: 'PUT', body: {} }) })
  const cancelUpload = useMutation({ mutationFn: (value: { key: string; itemId: string }) => request<{ recording_id: string | null }>('/recording-uploads/' + encodeURIComponent(value.key) + '/cancellation', { method: 'PUT', body: { plan_item_id: value.itemId } }) })
  const attempt = useMutationWithKey((b: Body, key) => post<Attempt>('/exercise-attempts', b, key))

  const finishCancellation = (recordingId?: string | null) => {
    if (me.data?.guest_id) forgetCancellation(me.data.guest_id, planItemId)
    if (currentItem.current !== planItemId) return
    uploadKey.current = null; canceling.current = false
    setRepeatFor(null); setResult(null); attempt.reset(); setLocalPending(null)
    setIgnored((old) => new Set([...old, ...[pendingTake?.recording_id, cancellation.intent?.recordingId, recordingId].filter((id): id is string => !!id)]))
    void itemState.refetch()
  }
  const sendCancellation = (intent: CancellationIntent) => {
    canceling.current = true
    cancellationTried.current = JSON.stringify(intent)
    if (intent.uploadKey) cancelUpload.mutate({ key: intent.uploadKey, itemId: intent.itemId }, { onSuccess: (result) => finishCancellation(result.recording_id) })
    else if (intent.recordingId) dismiss.mutate(intent.recordingId, { onSuccess: () => finishCancellation(intent.recordingId) })
  }
  useEffect(() => { setResult(null); setRepeatFor(null); setSelectedId(null); setLocalPending(null); setIgnored(new Set()); setRepeatSource(null); canceling.current = false; uploadKey.current = null; cancellationTried.current = null }, [planItemId])
  useEffect(() => {
    if (cancellation.intent && found && cancellationTried.current !== JSON.stringify(cancellation.intent)) sendCancellation(cancellation.intent)
  }, [cancellation.intent?.uploadKey, cancellation.intent?.recordingId, found?.item.id, me.data?.guest_id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (itemState.isPending) return <Frame><Skeleton height={360} /></Frame>
  if (itemState.error) return <Frame><ErrorBanner error={itemState.error} onRetry={() => itemState.refetch()} /><Link className="rs-link" to="/today">Back to today</Link></Frame>
  if (!found) return <Frame><ErrorBanner text="This exercise is not in your plan." /><Link className="rs-link" to="/today">Back to today</Link></Frame>
  const { lesson, item, index } = found
  const nextItem = lesson.items.find((x, i) => i !== index && x.status !== 'completed')
  const closedLesson = lesson.status === 'completed' || itemState.data?.plan_status === 'archived'
  const archivedTask = itemState.data?.plan_status === 'archived' && item.status !== 'completed'
  const lockedTask = lesson.status === 'locked' && item.status !== 'completed'
  const readOnlyTask = archivedTask || lockedTask
  const goNext = () => navigate(closedLesson ? '/today' : nextItem ? '/exercise/' + nextItem.id : '/done/' + lesson.id)
  const v = item.task.verification
  const submit = (b: Omit<Body, 'plan_item_id'>) =>
    attempt.mutate(
      { plan_item_id: item.id, ...(practicingAgain ? { practice_only: true, ...(basedOn ? { based_on_attempt_id: basedOn } : {}) } : {}), ...b },
      {
        onSuccess: (a) => {
          uploadKey.current = null
          setResult(a)
          setSelectedId(a.id)
          setIgnored((old) => new Set([...old, ...(pendingTake ? [pendingTake.recording_id] : []), ...(a.recording_id ? [a.recording_id] : [])]))
          setLocalPending(null)
          setRepeatFor(a.practice_only && a.status === 'needs_retry' ? planItemId : null)
          void qc.invalidateQueries({ queryKey: ['plan-item', item.id] })
          void qc.invalidateQueries({ queryKey: ['attempt-history', item.id] })
          void qc.invalidateQueries({ queryKey: ['progress'] })
          void qc.invalidateQueries({ queryKey: ['today'] })
          void qc.invalidateQueries({ queryKey: ['plan'] })
          void qc.invalidateQueries({ queryKey: ['me'] })
        },
        onError: (e) => {
          if (e instanceof ApiError && ['plan_item_already_completed', 'recording_already_used'].includes(e.code)) {
            setRepeatFor(null)
            setLocalPending(null)
            if (pendingTake) setIgnored((old) => new Set([...old, pendingTake.recording_id]))
            void qc.invalidateQueries({ queryKey: ['plan-item', item.id] })
            void qc.invalidateQueries({ queryKey: ['attempt-history', item.id] })
          }
        },
      },
    )
  const cancelRepeat = () => {
    const intent = cancellation.intent ?? ((uploadKey.current || pendingTake) ? {
      guestId: me.data?.guest_id ?? '', itemId: planItemId,
      ...(uploadKey.current ? { uploadKey: uploadKey.current } : {}),
      ...(pendingTake ? { recordingId: pendingTake.recording_id } : {}),
    } : null)
    if (!intent) { finishCancellation(); return }
    canceling.current = true
    cancellationTried.current = JSON.stringify(intent)
    if (intent.guestId) rememberCancellation(intent)
    sendCancellation(intent)
  }
  const trainingLocked = me.data?.capabilities?.daily_training === false
  const showOutcome = completed && !practicingAgain
  const progress = Math.round(((lesson.items.filter((x) => x.status === 'completed').length) / lesson.items.length) * 100)

  return (
    <div className="rs rs-page">
      <FlowHeader back="/today">
        <div className="rs-bar" role="progressbar" aria-valuenow={progress} aria-label={`Exercise ${index + 1} of ${lesson.items.length}`}>
          <span style={{ width: progress + '%' }} />
        </div>
      </FlowHeader>
      <main className="rs-wrap" style={{ paddingTop: 20, paddingBottom: 48 }}>
        <DemoNotice prepared={me.data?.data_provenance?.prepared_demo_history} enabled={me.data?.demo_mode} />
        <div className="rs-cols" style={{ gridTemplateColumns: 'minmax(0, .8fr) minmax(0, 1.2fr)' }}>
          <div className="rs-stack rs-gap-3">
            <h1 className="rs-h rs-h1">{item.title}</h1>
            <div className="rs-meta">

              <span>About {formatEstimate(item.estimated_duration_seconds)}</span>
              <span>{item.difficulty ?? ''}</span>
              <span>{completed ? 'Completion already credited' : `+${item.notes_available} notes`}</span>
            </div>
            {item.variant_label && <h2 className="rs-h rs-h2">{item.variant_label}</h2>}
            <p style={{ margin: 0 }}>{item.task.instruction}</p>
            {(item.task.timing?.expected_recording_seconds || item.task.timing?.includes_listening) && <p className="rs-label" style={{ margin: 0 }}>
              {item.task.timing?.expected_recording_seconds && `Typical take: ${item.task.timing.expected_recording_seconds.min}–${item.task.timing.expected_recording_seconds.max} sec. Finish at your own pace. `}
              {item.task.timing?.includes_listening && 'The session estimate includes recording, listening back and reflection.'}
            </p>}
            {item.task.reflection_prompt && <p style={{ margin: 0 }}><strong>Listen for:</strong> {item.task.reflection_prompt}</p>}
            {item.reason && <p style={{ margin: 0, fontSize: 15 }}><strong>Why today:</strong> {item.reason}</p>}
            {v.target_wpm && (
              <div>
                <span className="rs-badge" style={{ background: 'var(--sky-tint)', color: 'var(--sky-ink)' }}>
                  Target {v.target_wpm.min}–{v.target_wpm.max} wpm
                </span>
              </div>
            )}
          </div>
          <div className="rs-stack rs-gap-4">
            {(v.type === 'self_confirmation' || showOutcome || readOnlyTask || trainingLocked) && (
              <div className="rs-card" style={{ padding: 28 }}>
                {item.task.steps?.length ? <ol>{item.task.steps.map((step, n) => <li key={n}>{step}</li>)}</ol> : <ScriptText text={item.task.text} />}
              </div>
            )}
            {trainingLocked && !showOutcome ? <div className="rs-card rs-stack" style={{ padding: 24, gap: 12 }}>
              <h2 className="rs-h rs-h2">Practice requires a subscription</h2>
              <p>Your saved task and recordings stay available. Choose a plan to record a new take.</p>
              <Link className="rs-btn" to="/paywall">See subscription plans</Link>
            </div> : readOnlyTask ? <div className="rs-card rs-stack" style={{ padding: 24, gap: 12 }}>
              {archivedTask ? <><h2 className="rs-h rs-h2">Saved task preview</h2><p>This older task is saved for reference. Continue practice in your current plan.</p></> : <><h2 className="rs-h rs-h2">Session not open yet</h2><p>You can preview this task. New sessions open in order, with one session completed per local day. Check Today for your current session.</p><button className="rs-link" type="button" disabled={itemState.isFetching} onClick={() => { void itemState.refetch() }}>Check availability</button></>}
              <Link className="rs-link" to="/today">{archivedTask ? 'Back to current plan' : 'Back to today'}</Link>
            </div> : showOutcome ? (
              <div className="rs-card rs-stack" style={{ gap: 12, padding: 24 }}>
                <h2 className="rs-h" aria-live="polite" style={{ fontSize: 22 }}>{result?.status === 'needs_retry' ? 'Take needs another try' : result?.practice_only ? 'Extra practice saved' : result ? 'Practice complete' : 'Already done'}</h2>
                {result && <p style={{ margin: 0 }}>{result.feedback.summary}</p>}
                {result?.practice_only && <p style={{ margin: 0 }}>Extra practice does not add notes or complete the session again.</p>}
                {result?.status === 'needs_retry' && <p>Your exercise remains completed. This take needs another try.</p>}
                {result?.feedback.issues.map((issue) => <p key={issue.code} style={{ margin: 0 }}>{issue.message}</p>)}
                {typeof result?.feedback.metrics?.speaking_rate_wpm?.value === 'number' && <p style={{ margin: 0 }}>Measured pace: {Math.round(result.feedback.metrics.speaking_rate_wpm.value)} words/min</p>}
                {savedAttempt.isPending && item.latest_attempt_id && !latestLocal && <p>Loading your saved feedback…</p>}
                {savedAttempt.error && !latestLocal && <ErrorBanner error={savedAttempt.error} onRetry={() => savedAttempt.refetch()} />}
                {savedRecording.data?.audio_url && <AudioPlayer preload="metadata" aria-label="Your completed take" ref={audioRef} src={savedRecording.data.audio_url} />}
                {savedRecording.error && <ErrorBanner error={savedRecording.error} onRetry={() => savedRecording.refetch()} />}
                {!!result?.feedback.insights?.length && <section className="rs-stack" aria-label="Measured timing notes" style={{ gap: 10 }}>
                  <h3 className="rs-h rs-h3">Measured timing notes</h3>
                  {result.feedback.insights.map((insight) => <div key={insight.code}>
                    <p style={{ margin: 0 }}>{insight.message}</p>
                    {insight.evidence && <button className="rs-link" type="button" disabled={!savedRecording.data?.audio_url} onClick={() => { const audio = audioRef.current; if (audio) { audio.currentTime = insight.evidence!.start_seconds; void audio.play().catch(() => {}) } }}>Hear this moment: “{insight.evidence.quote}”</button>}
                  </div>)}
                  <span className="rs-label">Based on transcript timings. Playback helps you check the word boundary.</span>
                </section>}
                {timingIdea && <p><strong>Optional practice idea:</strong> {timingIdea}</p>}
                {result?.status === 'passed' && result.recording_id && <SpeechReview key={"speech-review-" + result.id} take={result} onHear={(seconds) => { const audio = audioRef.current; if (audio) { audio.currentTime = seconds; void audio.play().catch(() => {}) } }} />}
                {result?.listening_plan && <PlannedBoundary plan={result.listening_plan} feedback={result.feedback.planned_pause} onHear={savedRecording.data?.audio_url ? (seconds) => { const audio = audioRef.current; if (audio) { audio.currentTime = seconds; void audio.play().catch(() => {}) } } : undefined} />}
                {result?.practice_focus?.note && <p><strong>{result.training_focus ? 'Previous take’s reflection:' : 'Your focus for this take:'}</strong> {result.practice_focus.note}</p>}
                {result?.practice_focus && <TakeComparison key={"comparison-" + result.id} take={result} />}
                {result?.training_focus && <StoryFocus focus={result.training_focus} completed />}
                {result?.training_focus && result.status === 'passed' && <FocusCheck key={"focus-check-" + result.id} take={result} onSaved={updateViewedTake} />}
                {result && <TakeReflection key={"reflection-" + result.id} attempt={result} exerciseId={item.exercise_id} storyId={lesson.items.find((entry) => entry.exercise_id === 'E12')?.id} onSaved={updateViewedTake} />}
                {result?.feedback.coaching?.map((tip) => <p key={tip.code} style={{ margin: 0 }}>{timingDecision && tip.code === 'pace_outside_target' ? 'This take counts. The pace band is an optional drill target.' : tip.message}</p>)}
                {!!result?.reward.parts.length && <div className="rs-stack" style={{ gap: 8, padding: 16, borderRadius: 18, background: 'var(--success-tint)' }}>
                  {result.reward.parts.map((p) => (
                    <div key={p.reason} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <NoteIcon /> <strong>+{p.notes}</strong> {REASON[p.reason]}
                    </div>
                  ))}
                </div>}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="rs-btn rs-btn--wide" type="button" onClick={goNext}>
                  {closedLesson ? 'Back to today' : nextItem ? 'Next exercise' : 'Finish session'}
                </button>
                {trainingLocked ? <Link className="rs-btn rs-btn--secondary" to="/paywall">See subscription plans for extra practice</Link> : <button className="rs-btn rs-btn--secondary" type="button" onClick={() => { viewedTake.current = { itemId: planItemId, attemptId: null }; canceling.current = false; uploadKey.current = null; setRepeatSource(result?.id ?? null); setRepeatFor(planItemId); setResult(null); attempt.reset() }}>
                  Practice again — no extra notes
                </button>}
                </div>
              </div>
            ) : (
              <>
                {practicingAgain && <div className="rs-banner" role="status"><span>Extra practice. Your completion and notes are already saved.{(pendingTake?.practice_focus?.note || result?.reflection?.note) && <span> {item.exercise_id === 'E12' ? 'Previous take’s reflection:' : 'Your saved focus:'} {pendingTake?.practice_focus?.note || result?.reflection?.note}</span>}</span><button className="rs-link" type="button" disabled={attempt.isPending || dismiss.isPending || cancelUpload.isPending} onClick={cancelRepeat}>Cancel extra practice</button></div>}
                {dismiss.error && <ErrorBanner error={dismiss.error} onRetry={cancelRepeat} />}
                {cancelUpload.error && <ErrorBanner error={cancelUpload.error} onRetry={cancelRepeat} />}
                {cancellation.intent && <p role="status">Cancellation pending. The saved take will not be submitted while cancellation is being confirmed.</p>}
                {cancellation.intent && !cancellation.persistent && (cancelUpload.error || dismiss.error) && <p role="alert">Cancellation could not be saved on this device. Keep this page open and retry.</p>}
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
                {v.type === 'recording' && me.error && <ErrorBanner error={me.error} onRetry={() => me.refetch()} />}
                {v.type === 'recording' && me.isPending && <Skeleton height={160} />}
                {v.type === 'recording' && me.data && !cancellation.intent && <RecordCheck key={item.id + (practicingAgain ? '-repeat' : '-first')} practiceOnly={practicingAgain} basedOn={basedOn} trainingFocus={itemState.data?.training_focus} listeningExample={itemState.data?.listening_example} listeningBoundaries={itemState.data?.listening_boundaries} listeningPlan={itemState.data?.listening_plan} pendingTake={pendingTake} onUploadStarted={(key) => { uploadKey.current = key }} onUploaded={(take) => { setLocalPending({ itemId: item.id, take }) }} item={item} serverLimit={me.data.limits.max_recording_seconds} accepted={me.data.limits.accepted_audio_types} busy={attempt.isPending || dismiss.isPending || cancelUpload.isPending || canceling.current} onRecorded={(id, take) => { if (!canceling.current) submit({ recording_id: id, ...(take ? { based_on_attempt_id: take.based_on_attempt_id ?? undefined } : {}) }) }} />}
              </>
            )}
            {completed && <section className="rs-card rs-stack" aria-label="Your takes" style={{ padding: 24, gap: 12 }}>
              <h2 className="rs-h rs-h2">Your takes</h2>
              {history.isPending && <p>Loading your takes…</p>}
              {history.error && <ErrorBanner error={history.error} onRetry={() => history.refetch()} />}
              <ol className="rs-stack" style={{ paddingLeft: 22, gap: 10 }}>
                {takes.map((take) => <li key={take.id}><button className="rs-link" type="button" aria-pressed={result?.id === take.id} disabled={attempt.isPending || practicingAgain} onClick={() => { viewedTake.current = { itemId: planItemId, attemptId: take.id }; setSelectedId(take.id); setResult(null); setRepeatFor(null) }}>
                  {take.practice_only ? 'Extra practice' : 'First completion attempt'} · {take.status === 'passed' ? 'saved' : 'needs another try'}{take.created_at ? ' · ' + new Date(take.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: me.data?.preferences?.timezone ?? 'UTC' }) : ''}
                </button></li>)}
              </ol>
              {history.hasNextPage && <button className="rs-btn rs-btn--secondary" type="button" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>Load earlier takes</button>}
            </section>}
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
