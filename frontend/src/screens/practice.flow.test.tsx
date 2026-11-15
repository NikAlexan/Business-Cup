// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import type { Attempt, PlanItem, TrainingFocus } from '../api/types'
import * as recorder from '../lib/recorder'
import { clearCancellationIntents } from '../lib/cancellationIntent'
import Exercise from './Exercise'
import Main from './Main'
import MicCheck from './MicCheck'
import Record from './Record'
import Home from './Home'
import Profile from './Profile'

vi.mock('../components/UpdateBanner', () => ({ UpdateBanner: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearCancellationIntents(); vi.restoreAllMocks() })

function open(path: string, existingClient?: QueryClient) {
  const client = existingClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/" element={<Main />} />
    <Route path="/exercise/:planItemId" element={<Exercise />} />
    <Route path="/today" element={<Home />} />
    <Route path="/profile/:assessmentId" element={<Profile />} />
    <Route path="/record" element={<Record />} />
    <Route path="/setup" element={<MicCheck />} />
    <Route path="/mic-check" element={<h1>Microphone setup destination</h1>} />
    <Route path="/done/:lessonId" element={<h1>Session complete destination</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>)
}

const baseItem: PlanItem = {
  id: 'item', exercise_id: 'E06', position: 1, title: 'Steady reading pace', reason: 'Practice pace',
  status: 'completed', latest_attempt_id: 'attempt', estimated_duration_seconds: 90, notes_available: 4,
  task: { instruction: 'Read once, then listen.', text: 'A calm voice carries a clear message.',
    reflection_prompt: 'Did the ideas have room to land?', repetitions: 1,
    example: { type: 'text', text: '', audio_url: null },
    verification: { type: 'recording', min_elapsed_seconds: null, max_recording_seconds: 60, target_wpm: { min: 120, max: 150 } } },
}
const savedAttempt = {
  id: 'attempt', plan_item_id: 'item', status: 'passed', recording_id: 'recording',
  reward: { notes: 4, parts: [{ notes: 3, reason: 'exercise_completed' }, { notes: 1, reason: 'quality_bonus' }] },
  practice_seconds: 30, feedback: { summary: 'Recording received. Audio quality checked.', issues: [],
    coaching: [{ code: 'pace_outside_target', message: 'For future practice, explore a gentler pace.' }],
    metrics: { speaking_rate_wpm: { available: true, value: 165, unit: 'words/min', unavailable_reason: null } } },
} satisfies Attempt
const storyFocus: TrainingFocus = {
  id: 'focus-a', note: 'Leave room between ideas.', skill: 'pauses', skill_label: 'Meaningful pauses',
  listening_question: 'Does the pause help the meaning?', steps: ['Choose one thought boundary.', 'Read once and listen back.'],
  rubric_version: 'story-listening-v1', created_at: '2026-11-15T00:00:00Z',
  source_attempt_id: 'attempt', source_plan_item_id: 'item', source_recording_id: 'recording',
}
function setup(item: PlanItem, intercept?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const lesson = { id: 'lesson', items: [item] }
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const handled = intercept?.(path, init)
    if (handled) return handled
    const data: Record<string, unknown> = {
      '/api/v1/practice-focus': { focus: null, skills: { pace: { label: 'Comfortable pace', question: 'Can you follow the thought?', exercise_ids: ['E06'] }, pauses: { label: 'Meaningful pauses', question: 'Does the pause help the meaning?', exercise_ids: ['E08'] } }, last_check: null },
      '/api/v1/me': { guest_id: 'guest', preferences: { timezone: 'UTC' }, progress: { notes_total: 0, practice_seconds_total: 0, current_streak_days: 0 }, limits: { accepted_audio_types: ['audio/webm'], max_recording_seconds: 180 } },
      '/api/v1/plan-items/item': { item, lesson, item_index: 0, pending_take: null, plan_id: 'plan', plan_status: 'active' },
      '/api/v1/today': { lesson }, '/api/v1/plan': { lessons: [lesson] },
      '/api/v1/exercise-attempts/attempt': savedAttempt,
      '/api/v1/exercise-attempts?plan_item_id=item&limit=20': { items: [savedAttempt], next_cursor: null },
      '/api/v1/recordings/recording': { id: 'recording', audio_url: '/api/v1/recordings/recording/audio' },
    }
    if (!(path in data)) throw Error('Unexpected request: ' + path)
    return Response.json(data[path])
  })
  vi.stubGlobal('fetch', transport)
  return transport
}

test('keyboard goal selection updates focus, selection and the submitted onboarding goal', async () => {
  let body: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/guest-session')) { body = JSON.parse(String(init?.body)); return Response.json({ guest_id: 'guest' }) }
    return Response.json({ error: { message: 'No session yet' } }, { status: 401 })
  }))
  open('/')
  const user = userEvent.setup()
  const clear = screen.getByRole('radio', { name: /Clearer speech/ })
  clear.focus()
  await user.keyboard('{ArrowDown}')
  const expressive = screen.getByRole('radio', { name: /More expressive voice/ })
  expect(document.activeElement).toBe(expressive)
  expect(expressive.getAttribute('aria-checked')).toBe('true')
  await user.keyboard('{End}')
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Confident delivery/ }))
  const start = screen.getByRole('button', { name: 'Get started' }) as HTMLButtonElement
  expect(start.disabled).toBe(true)
  await user.click(screen.getByRole('checkbox'))
  await user.click(start)
  await screen.findByRole('heading', { name: 'Microphone setup destination' })
  expect(body?.goal).toBe('confident_delivery')
})

test('opening a completed exercise restores feedback, measured pace and its saved audio', async () => {
  setup(baseItem)
  open('/exercise/item')
  await screen.findByText('Measured pace: 165 words/min')
  expect(screen.getByText('For future practice, explore a gentler pace.')).toBeTruthy()
  const audio = await screen.findByLabelText('Your completed take')
  expect(audio.getAttribute('src')).toBe('/api/v1/recordings/recording/audio')
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull()
})

test('untimed steps complete by confirmation without a stopwatch payload', async () => {
  let payload: Record<string, unknown> | undefined
  const item: PlanItem = { ...baseItem, status: 'pending', latest_attempt_id: null,
    task: { ...baseItem.task, steps: ['Move gently five times.', 'Say pa, ta, ka three times.'],
      verification: { ...baseItem.task.verification, type: 'self_confirmation', target_wpm: null } } }
  setup(item, (path, init) => {
    if (path === '/api/v1/exercise-attempts') { payload = JSON.parse(String(init?.body)); return Response.json({ ...savedAttempt, recording_id: null, feedback: { summary: 'Practice completed.', issues: [] } }) }
  })
  open('/exercise/item')
  const complete = await screen.findByRole('button', { name: 'Complete' }) as HTMLButtonElement
  expect(complete.disabled).toBe(true)
  expect(screen.getByRole('list')).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(complete)
  await screen.findByText('Practice completed.')
  expect(payload).toEqual({ plan_item_id: 'item', self_confirmed: true })
  fireEvent.click(screen.getByRole('button', { name: 'Finish session' }))
  await screen.findByRole('heading', { name: 'Session complete destination' })
})

test('a failed attempt submission reuses the checked take and idempotency key', async () => {
  vi.spyOn(recorder, 'useRecorder').mockReturnValue({
    state: 'recorded', level: { level: 0, status: 'waiting' }, seconds: 30, mime: 'audio/webm',
    blob: new Blob(['take'], { type: 'audio/webm' }), url: 'blob:take', error: null, limitReached: false,
    start: vi.fn(), stop: vi.fn(), reset: vi.fn(),
  })
  let uploads = 0
  const attempts: RequestInit[] = []
  setup({ ...baseItem, status: 'pending', latest_attempt_id: null }, (path, init) => {
    if (path === '/api/v1/recordings') { uploads++; return Response.json({ job_id: 'job', recording: { id: 'recording' } }, { status: 202 }) }
    if (path === '/api/v1/jobs/job') return Response.json({ status: 'completed', poll_after_ms: null })
    if (path === '/api/v1/exercise-attempts') {
      attempts.push(init!)
      return attempts.length === 1 ? Response.json({ error: { message: 'Temporary save failure' } }, { status: 503 }) : Response.json(savedAttempt)
    }
  })
  open('/exercise/item')
  fireEvent.click(await screen.findByRole('button', { name: 'Check my take' }))
  await screen.findByText('Temporary save failure')
  await waitFor(() => expect((screen.getByRole('button', { name: 'Check my take' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Check my take' }))
  await screen.findByText('Measured pace: 165 words/min')
  expect(uploads).toBe(1)
  expect(attempts).toHaveLength(2)
  expect(attempts[0].body).toBe(attempts[1].body)
  expect(attempts[0].headers).toEqual(attempts[1].headers)
})


test('leaving mic setup before granting permission does not open an audio context', async () => {
  const stop = vi.fn()
  const context = vi.fn()
  let grant!: (stream: MediaStream) => void
  const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('AudioContext', context)
  const view = open('/setup')
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
  view.unmount()
  grant({ getTracks: () => [{ stop }] } as unknown as MediaStream)
  await waitFor(() => expect(stop).toHaveBeenCalledOnce())
  expect(context).not.toHaveBeenCalled()
})

test('mic setup meter failure releases its stream and presents a retry action', async () => {
  const stop = vi.fn()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } })
  vi.spyOn(recorder, 'meter').mockImplementation(() => { throw Error('unsupported meter') })
  open('/setup')
  await screen.findByRole('heading', { name: "We couldn't start the microphone" })
  expect(stop).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})


test('extra practice sends explicit mode, shows zero reward and keeps the original take selectable', async () => {
  vi.spyOn(recorder, 'useRecorder').mockReturnValue({
    state: 'recorded', level: { level: 0, status: 'waiting' }, seconds: 25, mime: 'audio/webm',
    blob: new Blob(['extra take'], { type: 'audio/webm' }), url: 'blob:extra', error: null, limitReached: false,
    start: vi.fn(), stop: vi.fn(), reset: vi.fn(),
  })
  let body: Record<string, unknown> | undefined
  const extra = { ...savedAttempt, id: 'extra', practice_only: true, recording_id: 'extra-recording', reward: { notes: 0, parts: [] } }
  let rows = [savedAttempt]
  setup(baseItem, (path, init) => {
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: rows, next_cursor: null })
    if (path === '/api/v1/recordings') {
      expect((init?.body as FormData).get('practice_only')).toBe('true')
      return Response.json({ job_id: 'extra-job', recording: { id: 'extra-recording' } }, { status: 202 })
    }
    if (path === '/api/v1/jobs/extra-job') return Response.json({ status: 'completed', poll_after_ms: null })
    if (path === '/api/v1/exercise-attempts') {
      body = JSON.parse(String(init?.body)); rows = [extra, savedAttempt]
      return Response.json(extra)
    }
    if (path === '/api/v1/recordings/extra-recording') return Response.json({ audio_url: '/api/v1/recordings/extra-recording/audio' })
  })
  open('/exercise/item')
  await screen.findByText('Measured pace: 165 words/min')
  fireEvent.click(screen.getByRole('button', { name: 'Practice again — no extra notes' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check my take' }))
  await screen.findByRole('heading', { name: 'Extra practice saved' })
  expect(body).toEqual({ plan_item_id: 'item', recording_id: 'extra-recording', practice_only: true, based_on_attempt_id: 'attempt' })
  expect(screen.queryByText('Clean recording bonus')).toBeNull()
  expect((await screen.findByLabelText('Your completed take')).getAttribute('src')).toBe('/api/v1/recordings/extra-recording/audio')
  fireEvent.click(await screen.findByRole('button', { name: /First completion attempt · saved/ }))
  await waitFor(() => expect(screen.getByLabelText('Your completed take').getAttribute('src')).toBe('/api/v1/recordings/recording/audio'))
})

test('cancelled extra practice keeps the saved feedback without creating an attempt', async () => {
  const transport = setup(baseItem)
  open('/exercise/item')
  await screen.findByText('Measured pace: 165 words/min')
  fireEvent.click(screen.getByRole('button', { name: 'Practice again — no extra notes' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel extra practice' }))
  await screen.findByRole('heading', { name: 'Practice complete' })
  expect(transport.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})


test('retrying an assessment upload starts polling and advances after quality acceptance', async () => {
  const reset = vi.fn()
  vi.spyOn(recorder, 'useRecorder').mockReturnValue({
    state: 'recorded', level: { level: 0, status: 'waiting' }, seconds: 25, mime: 'audio/webm',
    blob: new Blob(['assessment take'], { type: 'audio/webm' }), url: 'blob:assessment', error: null, limitReached: false,
    start: vi.fn(), stop: vi.fn(), reset,
  })
  let accepted = false
  let uploads = 0
  let polls = 0
  const keys: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/v1/me') return Response.json({ limits: { accepted_audio_types: ['audio/webm'] } })
    if (path === '/api/v1/assessments/assessment') return Response.json({ id: 'assessment', status: 'draft', tasks: [{ id: 'task', kind: 'control_text', order: 1, instruction: 'Read naturally.', text: 'A short test passage.', max_duration_seconds: 60, recording_id: accepted ? 'recording' : null, quality_status: accepted ? 'accepted' : null }] })
    if (path === '/api/v1/recordings') {
      keys.push(init?.headers); uploads++
      return uploads === 1 ? Response.json({ error: { message: 'Temporary upload failure' } }, { status: 503 }) : Response.json({ job_id: 'check', recording: { id: 'recording' } }, { status: 202 })
    }
    if (path === '/api/v1/jobs/check') { accepted = true; polls++; return Response.json({ status: 'completed', poll_after_ms: null }) }
    throw Error('Unexpected request: ' + path)
  }))
  open('/record?assessment_id=assessment')
  fireEvent.click(await screen.findByRole('button', { name: 'Use this take' }))
  await screen.findByText('Temporary upload failure')
  expect(reset).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'All 1 tasks recorded' })
  expect(polls).toBe(1)
  expect(keys[0]).toEqual(keys[1])
})


test('a rejected extra take restores its feedback without reopening the completed exercise', async () => {
  const bad = { ...savedAttempt, id: 'bad', practice_only: true, status: 'needs_retry', recording_id: 'bad-recording',
    reward: { notes: 0, parts: [] }, feedback: { summary: 'Please try this take again.', issues: [{ code: 'too_short', message: 'Record some more audible speech.' }] } }
  setup(baseItem, (path) => {
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [bad, savedAttempt], next_cursor: null })
    if (path === '/api/v1/recordings/bad-recording') return Response.json({ audio_url: '/api/v1/recordings/bad-recording/audio' })
  })
  open('/exercise/item')
  await screen.findByRole('heading', { name: 'Take needs another try' })
  expect(screen.getByText('Your exercise remains completed. This take needs another try.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /First completion attempt · saved/ }))
  await screen.findByRole('heading', { name: 'Practice complete' })
})


test('a recovered take survives polling and save failures without uploading the file again', async () => {
  vi.spyOn(recorder, 'useRecorder').mockReturnValue({
    state: 'idle', level: { level: 0, status: 'waiting' }, seconds: 0, mime: null, blob: null, url: null, error: null, limitReached: false,
    start: vi.fn(), stop: vi.fn(), reset: vi.fn(),
  })
  const pending = { ...baseItem, status: 'pending' as const, latest_attempt_id: null }
  let online = false
  let saves = 0
  const headers: unknown[] = []
  setup(pending, (path, init) => {
    if (path === '/api/v1/plan-items/item') return Response.json({ item: saves > 1 ? baseItem : pending, lesson: { id: 'lesson', items: [baseItem] }, item_index: 0,
      pending_take: saves > 1 ? null : { recording_id: 'recording', job_id: 'recover', practice_only: false, status: 'queued' } })
    if (path === '/api/v1/jobs/recover') return online ? Response.json({ status: 'completed', poll_after_ms: null }) : Response.json({ error: { message: 'Polling is offline' } }, { status: 503 })
    if (path === '/api/v1/exercise-attempts') {
      saves++; headers.push(init?.headers)
      return saves === 1 ? Response.json({ error: { message: 'Save is offline' } }, { status: 503 }) : Response.json(savedAttempt)
    }
    if (path === '/api/v1/recordings') throw Error('Must not upload again')
  })
  open('/exercise/item')
  await screen.findByText('Polling is offline')
  expect(saves).toBe(0)
  online = true
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Save is offline')
  fireEvent.click(await screen.findByRole('button', { name: 'Save checked take' }))
  await screen.findByRole('heading', { name: 'Practice complete' })
  expect(saves).toBe(2)
  expect(headers[0]).toEqual(headers[1])
})

test('saved reflection becomes the next takes focus and is restored when selecting its source', async () => {
  vi.spyOn(recorder, 'useRecorder').mockReturnValue({
    state: 'recorded', level: { level: 0, status: 'waiting' }, seconds: 25, mime: 'audio/webm', blob: new Blob(['take']), url: 'blob:take', error: null, limitReached: false,
    start: vi.fn(), stop: vi.fn(), reset: vi.fn(),
  })
  const note = 'Let the final word land.'
  let original = savedAttempt as typeof savedAttempt & { reflection?: { note: string; updated_at: string } }
  const extra = { ...savedAttempt, id: 'extra', practice_only: true, practice_focus: { attempt_id: 'attempt', note }, recording_id: 'extra-recording', reward: { notes: 0, parts: [] } }
  let rows: unknown[] = [original]
  setup(baseItem, (path, init) => {
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: rows, next_cursor: null })
    if (path === '/api/v1/exercise-attempts/attempt/reflection') {
      expect(init?.method).toBe('PUT')
      original = { ...original, reflection: { note: JSON.parse(String(init?.body)).note, updated_at: '2026-11-14T12:00:00Z' } }
      rows = [original]; return Response.json(original)
    }
    if (path === '/api/v1/recordings') {
      expect((init?.body as FormData).get('based_on_attempt_id')).toBe('attempt')
      return Response.json({ job_id: 'focus-job', recording: { id: 'extra-recording' } }, { status: 202 })
    }
    if (path === '/api/v1/recordings/extra-recording') return Response.json({ audio_url: '/api/v1/recordings/extra-recording/audio' })
    if (path === '/api/v1/jobs/focus-job') return Response.json({ status: 'completed', poll_after_ms: null })
    if (path === '/api/v1/exercise-attempts') { rows = [extra, original]; return Response.json(extra) }
  })
  open('/exercise/item')
  const reflection = await screen.findByRole('textbox', { name: 'Your listening note' })
  fireEvent.change(reflection, { target: { value: note } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }))
  await screen.findByText('Reflection saved with this take.')
  fireEvent.click(screen.getByRole('button', { name: 'Practice again — no extra notes' }))
  expect(screen.getByText('Your saved focus:', { exact: false })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Check my take' }))
  await screen.findByRole('heading', { name: 'Extra practice saved' })
  expect(screen.getByText('Your focus for this take:')).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: /First completion attempt · saved/ }))
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(note))
})

test('a timing observation seeks its saved audio to the cited moment', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const observed = { ...savedAttempt, feedback: { ...savedAttempt.feedback,
    insights: [{ code: 'longest_pause', source: 'transcript_timing', message: 'Longest word gap: 1.2 seconds.', evidence: { quote: 'one … change', start_seconds: 2.5, end_seconds: 5.0 } }],
    next_step: 'Let one sentence settle.' } }
  setup(baseItem, (path) => path.startsWith('/api/v1/exercise-attempts?') ? Response.json({ items: [observed], next_cursor: null }) : undefined)
  open('/exercise/item')
  const hear = await screen.findByRole('button', { name: /Hear this moment/ })
  await waitFor(() => expect((hear as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(hear)
  expect((screen.getByLabelText('Your completed take') as HTMLAudioElement).currentTime).toBe(2.5)
  expect(play).toHaveBeenCalledOnce()
})

test.each([true, false])('repeat comparison restores source playback and only compares compatible timings: %s', async (compatible) => {
  const before = { ...savedAttempt, feedback: { ...savedAttempt.feedback, version: 'speech-timing-feedback-v1' } }
  const extra = { ...savedAttempt, id: 'extra', practice_only: true, practice_focus: { attempt_id: 'attempt', note: 'Let the final word land.', intent: 'keep' },
    feedback: { ...savedAttempt.feedback, version: compatible ? 'speech-timing-feedback-v1' : 'older-timing',
      metrics: { speaking_rate_wpm: { available: true, value: 140, unit: 'words/min', unavailable_reason: null } } } }
  setup(baseItem, (path) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(before)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [extra, before], next_cursor: null })
  })
  open('/exercise/item')
  expect((await screen.findByLabelText('Previous take for comparison')).getAttribute('src')).toBe('/api/v1/recordings/recording/audio')
  expect(screen.getByText('You chose to keep a useful feature for this take.')).toBeTruthy()
  if (compatible) {
    expect(screen.getByRole('cell', { name: '165 words/min' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '140 words/min' })).toBeTruthy()
  } else expect(screen.queryByRole('table')).toBeNull()
})

test('a recovered retryable job resumes the saved check without uploading audio again', async () => {
  const item = { ...baseItem, status: 'pending' as const, latest_attempt_id: null }
  let retried = false
  let uploads = 0
  setup(item, (path) => {
    if (path === '/api/v1/plan-items/item') return Response.json({ plan_status: 'active', item, lesson: { id: 'lesson', items: [item] }, item_index: 0,
      pending_take: { recording_id: 'recording', job_id: 'saved-check', practice_only: false, status: 'failed' } })
    if (path === '/api/v1/jobs/saved-check') return Response.json(retried ? { status: 'completed' } : { status: 'failed', retryable: true, error: { message: 'Temporary decoder failure' } })
    if (path === '/api/v1/jobs/saved-check/retry') { retried = true; return Response.json({ job_id: 'saved-check' }, { status: 202 }) }
    if (path === '/api/v1/recordings') { uploads++; throw Error('Saved audio must not be uploaded again') }
    if (path === '/api/v1/exercise-attempts') return Response.json(savedAttempt)
  })
  open('/exercise/item')
  await screen.findByText('Temporary decoder failure')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'Practice complete' })
  expect(retried).toBe(true)
  expect(uploads).toBe(0)
})

test('background speech coaching refreshes after its job finishes and seeks grounded evidence', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  let finished = false
  const review = { status: 'queued', job_id: 'speech-job', report: null }
  const pending = { ...savedAttempt, speech_review: review }
  const report = { summary: 'Listen to the phrase ending.', observation: { text: 'Check the final word.', evidence: { quote: 'clear message', start_seconds: 3, end_seconds: 5, note: 'Some words had no separate time span; replay this wider phrase to check the observation.' } },
    next_step: 'Let the final word land.', listening_question: 'Can you hear the final sound?', limitations: ['One take only.'] }
  setup(baseItem, (path) => {
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [pending], next_cursor: null })
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(finished ? { ...pending, speech_review: { ...review, status: 'completed', report } } : pending)
    if (path === '/api/v1/jobs/speech-job') { finished = true; return Response.json({ status: 'completed' }) }
  })
  open('/exercise/item')
  await screen.findByText('Listen to the phrase ending.')
  expect(screen.getByText('Let the final word land.')).toBeTruthy()
  expect(screen.getByText('AI impressions need your listening check. They do not score this take.')).toBeTruthy()
  expect(screen.getByText('Some words had no separate time span; replay this wider phrase to check the observation.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Listen to “clear message”' }))
  expect((screen.getByLabelText('Your completed take') as HTMLAudioElement).currentTime).toBe(3)
  expect(play).toHaveBeenCalledOnce()
})

test('a speech-coaching failure keeps saved audio, reflection and completion available', async () => {
  const failed = { ...savedAttempt, speech_review: { status: 'failed', job_id: 'failed-speech', report: null } }
  let retried = false
  setup(baseItem, (path) => {
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [failed], next_cursor: null })
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(failed)
    if (path === '/api/v1/jobs/failed-speech') return Response.json({ status: retried ? 'queued' : 'failed', retryable: !retried, poll_after_ms: 100000 })
    if (path === '/api/v1/jobs/failed-speech/retry') { retried = true; return Response.json({ job_id: 'failed-speech' }, { status: 202 }) }
  })
  open('/exercise/item')
  fireEvent.click(await screen.findByRole('button', { name: 'Retry speech coaching' }))
  await waitFor(() => expect(retried).toBe(true))
  expect(screen.getByLabelText('Your completed take')).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Your listening note' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Practice again — no extra notes' })).toBeTruthy()
})

test.each([false, true])('canceling a delayed accepted upload cannot resurrect a repeat, including cancellation failure: %s', async (failCancel) => {
  vi.spyOn(recorder, 'useRecorder').mockReturnValue({
    state: 'recorded', level: { level: 0, status: 'waiting' }, seconds: 25, mime: 'audio/webm', blob: new Blob(['take']), url: 'blob:take', error: null, limitReached: false,
    start: vi.fn(), stop: vi.fn(), reset: vi.fn(),
  })
  let resolveUpload!: (response: Response) => void
  let uploads = 0, cancellations = 0, saves = 0, polls = 0
  let key = '', canceled = false
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/recordings') {
      uploads++; key = (init?.headers as Record<string, string>)['Idempotency-Key']
      return new Promise<Response>((resolve) => { resolveUpload = resolve })
    }
    if (path === '/api/v1/recording-uploads/' + key + '/cancellation') {
      cancellations++
      expect(JSON.parse(String(init?.body))).toEqual({ plan_item_id: 'item' })
      if (failCancel && cancellations === 1) return Response.json({ error: { message: 'Cancellation is offline' } }, { status: 503 })
      canceled = true; return Response.json({ status: 'canceled', recording_id: 'late-recording' })
    }
    if (path === '/api/v1/jobs/late-job') { polls++; return Response.json({ status: 'completed' }) }
    if (path === '/api/v1/exercise-attempts') { saves++; throw Error('Canceled upload cannot become an attempt') }
  })
  const view = open('/exercise/item')
  fireEvent.click(await screen.findByRole('button', { name: 'Practice again — no extra notes' }))
  fireEvent.click(screen.getByRole('button', { name: 'Check my take' }))
  await waitFor(() => expect(uploads).toBe(1))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel extra practice' }))
  if (failCancel) {
    await screen.findByText('Cancellation is offline')
    resolveUpload(Response.json({ recording: { id: 'late-recording' }, job_id: 'late-job' }, { status: 202 }))
    await screen.findByText('Cancellation pending. The saved take will not be submitted while cancellation is being confirmed.')
    expect(screen.queryByRole('button', { name: 'Record again' })).toBeNull()
    expect(polls).toBe(0)
    expect(saves).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  }
  await screen.findByRole('heading', { name: 'Practice complete' })
  if (!failCancel) resolveUpload(Response.json({ recording: { id: 'late-recording' }, job_id: 'late-job' }, { status: 202 }))
  view.unmount()
  open('/exercise/item')
  await screen.findByRole('heading', { name: 'Practice complete' })
  expect(canceled).toBe(true)
  expect(saves).toBe(0)
  expect(uploads).toBe(1)
  expect(cancellations).toBe(failCancel ? 2 : 1)
})

test.each(['polling', 'failed'])('baseline resumes a saved quality check without a Blob or reupload: %s', async (mode) => {
  const reset = vi.fn()
  vi.spyOn(recorder, 'useRecorder').mockReturnValue({ state: 'idle', level: { level: 0, status: 'waiting' }, seconds: 0, mime: null, blob: null, url: null, error: null, limitReached: false, start: vi.fn(), stop: vi.fn(), reset })
  let resume = false, accepted = false, uploads = 0, retries = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path === '/api/v1/me') return Response.json({ limits: { accepted_audio_types: ['audio/webm'] } })
    if (path === '/api/v1/assessments/assessment') return Response.json({ id: 'assessment', status: 'draft', tasks: [{ id: 'task', kind: 'control_text', order: 1, instruction: 'Read naturally.', text: 'A passage.', max_duration_seconds: 60, recording_id: accepted ? 'recording' : null, quality_status: accepted ? 'accepted' : null,
      pending_take: accepted ? null : { recording_id: 'recording', job_id: 'saved-quality', status: mode === 'failed' ? 'failed' : 'queued', practice_only: false } }] })
    if (path === '/api/v1/jobs/saved-quality/retry') { retries++; resume = true; return Response.json({ job_id: 'saved-quality' }, { status: 202 }) }
    if (path === '/api/v1/jobs/saved-quality') {
      if (resume) { accepted = true; return Response.json({ status: 'completed' }) }
      return mode === 'polling' ? Response.json({ error: { message: 'Polling offline' } }, { status: 503 }) : Response.json({ status: 'failed', retryable: true, error: { message: 'Check needs retry' } })
    }
    if (path === '/api/v1/recordings') { uploads++; throw Error('Must reuse saved recording') }
    throw Error('Unexpected request: ' + path)
  }))
  open('/record?assessment_id=assessment')
  await screen.findByText(mode === 'polling' ? 'Polling offline' : 'Check needs retry')
  if (mode === 'polling') resume = true
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'All 1 tasks recorded' })
  expect(uploads).toBe(0)
  expect(retries).toBe(mode === 'failed' ? 1 : 0)
})

test('reload replays a stored cancellation before a completed saved check can create an attempt', async () => {
  const key = 'restore-cancel'
  localStorage.setItem('voice.cancellation.guest.item', JSON.stringify({ guestId: 'guest', itemId: 'item', uploadKey: key }))
  let online = false, canceled = false, cancellationCalls = 0, polls = 0, saves = 0
  setup(baseItem, (path) => {
    if (path === '/api/v1/plan-items/item') return Response.json({ item: baseItem, lesson: { id: 'lesson', items: [baseItem] }, item_index: 0, plan_status: 'active', pending_take: canceled ? null : { recording_id: 'extra', job_id: 'completed-extra', practice_only: true, status: 'completed' } })
    if (path === '/api/v1/recording-uploads/' + key + '/cancellation') {
      cancellationCalls++
      if (!online) return Response.json({ error: { message: 'Cancellation is offline' } }, { status: 503 })
      canceled = true; return Response.json({ status: 'canceled', recording_id: 'extra' })
    }
    if (path === '/api/v1/jobs/completed-extra') { polls++; return Response.json({ status: 'completed' }) }
    if (path === '/api/v1/exercise-attempts') { saves++; throw Error('Stored cancellation must prevent saving') }
  })
  const view = open('/exercise/item')
  await screen.findByText('Cancellation is offline')
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull()
  expect(polls).toBe(0)
  expect(saves).toBe(0)
  view.unmount()
  online = true
  open('/exercise/item')
  await screen.findByRole('heading', { name: 'Practice complete' })
  expect(cancellationCalls).toBe(2)
  expect(polls).toBe(0)
  expect(saves).toBe(0)
  expect(localStorage.getItem('voice.cancellation.guest.item')).toBeNull()
})

test('check-in restores the actual previous setup before recording', async () => {
  const stop = vi.fn()
  vi.spyOn(recorder, 'getMic').mockResolvedValue({ getTracks: () => [{ stop }], getAudioTracks: () => [{ label: 'USB microphone' }] } as unknown as MediaStream)
  vi.spyOn(recorder, 'meter').mockReturnValue(vi.fn())
  let submitted: Record<string, unknown> | undefined
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === '/api/v1/me') return Response.json({ latest_assessment_id: 'previous' })
    if (path === '/api/v1/assessments/previous') return Response.json({ id: 'previous', recording_conditions: { device_label: 'USB microphone', distance_cm: 50, environment: 'some_noise', notes: 'Mic on the stand.' } })
    if (path === '/api/v1/assessments') { submitted = JSON.parse(String(init?.body)); return Response.json({ id: 'new' }, { status: 201 }) }
    if (path === '/api/v1/assessments/new') return Response.json({ id: 'new', status: 'draft', tasks: [] })
    throw Error('Unexpected request: ' + path)
  }))
  open('/setup?kind=reassessment')
  await screen.findByRole('heading', { name: 'Previous recording setup' })
  await waitFor(() => expect((screen.getByLabelText('Distance to the mic') as HTMLSelectElement).value).toBe('50'))
  expect((screen.getByRole('radio', { name: 'Some noise' }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('textbox', { name: 'Setup notes (optional)' }) as HTMLTextAreaElement).value).toBe('Mic on the stand.')
  await waitFor(() => expect((screen.getByRole('button', { name: 'Start the 3 tasks' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Start the 3 tasks' }))
  await waitFor(() => expect(submitted?.recording_conditions).toEqual({ device_label: 'USB microphone', distance_cm: 50, environment: 'some_noise', notes: 'Mic on the stand.' }))
})

test('a reflection becomes a story focus, survives narration and saves a subjective listening check', async () => {
  vi.spyOn(recorder, 'useRecorder').mockReturnValue({ state: 'recorded', level: { level: 0, status: 'waiting' }, seconds: 25, mime: 'audio/webm', blob: new Blob(['take']), url: 'blob:take', error: null, limitReached: false, start: vi.fn(), stop: vi.fn(), reset: vi.fn() })
  const story: PlanItem = { ...baseItem, id: 'story', exercise_id: 'E12', title: 'Read a new story', status: 'pending', latest_attempt_id: null }
  const lesson = { id: 'lesson', items: [baseItem, story] }
  let active: TrainingFocus | null = null
  let posted = false
  let check: { outcome: string; source: string; updated_at: string } | undefined
  let original = { ...savedAttempt, reflection: { note: '', updated_at: '' } }
  const completedStory = () => ({ ...savedAttempt, id: 'story-take', plan_item_id: 'story', recording_id: 'story-recording', training_focus: storyFocus, focus_check: check, feedback: { summary: 'Story saved.', issues: [] } })
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/plan-items/item') return Response.json({ item: baseItem, lesson, item_index: 0, plan_status: 'active', pending_take: null })
    if (path === '/api/v1/practice-focus') {
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ source_attempt_id: 'attempt', note: storyFocus.note, skill: 'pauses', intent: 'experiment', expected_reflection_revision: 0 })
        active = storyFocus; original = { ...original, reflection: { note: storyFocus.note, updated_at: 'now' } }
        return Response.json({ focus: active, source_attempt: original }, { status: 201 })
      }
      return Response.json({ focus: active, skills: { pauses: { label: 'Meaningful pauses', question: storyFocus.listening_question, exercise_ids: ['E08'] } }, last_check: null })
    }
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(original)
    if (path === '/api/v1/plan-items/story') return Response.json({ item: posted ? { ...story, status: 'completed', latest_attempt_id: 'story-take' } : story, lesson, item_index: 1, plan_status: 'active', pending_take: null, training_focus: active })
    if (path === '/api/v1/recordings') {
      expect((init?.body as FormData).get('training_focus_id')).toBe(storyFocus.id)
      return Response.json({ recording: { id: 'story-recording', training_focus: active }, job_id: 'story-check' }, { status: 202 })
    }
    if (path === '/api/v1/jobs/story-check') return Response.json({ status: 'completed' })
    if (path === '/api/v1/exercise-attempts') { posted = true; return Response.json(completedStory()) }
    if (path === '/api/v1/exercise-attempts/story-take') return Response.json(completedStory())
    if (path === '/api/v1/exercise-attempts?plan_item_id=story&limit=20') return Response.json({ items: posted ? [completedStory()] : [], next_cursor: null })
    if (path === '/api/v1/recordings/story-recording') return Response.json({ audio_url: '/api/v1/recordings/story-recording/audio' })
    if (path === '/api/v1/exercise-attempts/story-take/focus-check') {
      check = { outcome: JSON.parse(String(init?.body)).outcome, source: 'user_listening', updated_at: 'now' }
      return Response.json(completedStory())
    }
  })
  const view = open('/exercise/item')
  const note = await screen.findByRole('textbox', { name: 'Your listening note' })
  fireEvent.change(note, { target: { value: storyFocus.note } })
  await screen.findByRole('option', { name: 'Meaningful pauses' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Focus for story practice' }), { target: { value: 'pauses' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Try one small change' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save for story practice' }))
  fireEvent.click(await screen.findByRole('link', { name: 'Open the story' }))
  await screen.findByRole('heading', { name: 'One focus for this story' })
  fireEvent.click(screen.getByRole('button', { name: 'Check my take' }))
  await screen.findByRole('heading', { name: 'Focus used for this take' })
  fireEvent.click(screen.getByRole('button', { name: 'Partly' }))
  await screen.findByText('Listening check saved with this take.')
  expect(check?.source).toBe('user_listening')
  view.unmount()
  open('/exercise/story')
  await screen.findByRole('heading', { name: 'Focus used for this take' })
  expect(screen.getByRole('button', { name: 'Partly' }).getAttribute('aria-pressed')).toBe('true')
})

test('the focus shown when recording starts stays bound to that take if the active focus changes', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const blob = new Blob(['story'])
  vi.spyOn(recorder, 'useRecorder').mockImplementation(() => {
    const [state, setState] = useState<'idle' | 'recording' | 'recorded'>('idle')
    return { state, level: { level: 0, status: 'waiting' }, seconds: 20, mime: state === 'recorded' ? 'audio/webm' : null,
      blob: state === 'recorded' ? blob : null, url: state === 'recorded' ? 'blob:story' : null, error: null, limitReached: false,
      start: async () => { setState('recording') }, stop: () => setState('recorded'), reset: () => setState('idle') }
  })
  const story: PlanItem = { ...baseItem, id: 'story', exercise_id: 'E12', status: 'pending', latest_attempt_id: null }
  const state = { item: story, lesson: { id: 'lesson', items: [story] }, item_index: 0, plan_status: 'active', pending_take: null, training_focus: storyFocus }
  let sent: string | null = null
  setup(story, (path, init) => {
    if (path === '/api/v1/plan-items/story') return Response.json(state)
    if (path === '/api/v1/recordings') {
      sent = (init?.body as FormData).get('training_focus_id') as string
      return Response.json({ error: { message: 'Stop after verifying the captured focus' } }, { status: 503 })
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  open('/exercise/story', client)
  fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
  await screen.findByRole('button', { name: 'Stop recording' })
  act(() => client.setQueryData(['plan-item', 'story'], { ...state, training_focus: { ...storyFocus, id: 'focus-b', note: 'A different future focus.' } }))
  expect(screen.queryByText('A different future focus.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check my take' }))
  await screen.findByText('Stop after verifying the captured focus')
  expect(sent).toBe(storyFocus.id)
})

test('a completed day still exposes its exercises for review and marks prepared history', async () => {
  const lesson = { id: 'lesson', day_index: 1, status: 'completed', items: [baseItem], estimated_duration_seconds: 90 }
  setup(baseItem, (path) => {
    if (path === '/api/v1/me') return Response.json({ preferences: { timezone: 'UTC' }, data_provenance: { prepared_demo_history: true }, progress: { notes_total: 4, practice_seconds_total: 30, current_streak_days: 1 }, limits: { accepted_audio_types: ['audio/webm'], max_recording_seconds: 180 } })
    if (path === '/api/v1/today') return Response.json({ lesson, daily_status: 'completed', timezone: 'UTC', reassessment: {} })
    if (path === '/api/v1/plan') return Response.json({ lessons: [lesson], total_lessons: 14 })
    if (path === '/api/v1/progress') return Response.json({ activity: [] })
  })
  open('/today')
  await screen.findByRole('heading', { name: 'Review or practice again' })
  expect(screen.getByText('Prepared demo history is included. New takes use uploaded audio.')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: 'Steady reading pace, done' }))
  await screen.findByRole('button', { name: 'Practice again — no extra notes' })
})

test('check-in exposes paired private baseline and current audio', async () => {
  setup(baseItem, (path) => {
    if (path === '/api/v1/assessments/checkin') return Response.json({ id: 'checkin', kind: 'reassessment', status: 'completed', measurements: {}, report: { summary: '', observations: [], priorities: [] }, comparison: {
      summary: 'Listen to both takes.', metrics: {}, audio_pairs: [{ kind: 'control_text', before_audio_url: '/api/v1/recordings/before/audio', after_audio_url: '/api/v1/recordings/after/audio' }],
    } })
    if (path === '/api/v1/exercises') return Response.json({ items: [] })
  })
  open('/profile/checkin')
  expect((await screen.findByLabelText('Before: control_text')).getAttribute('src')).toBe('/api/v1/recordings/before/audio')
  expect(screen.getByLabelText('After: control_text').getAttribute('src')).toBe('/api/v1/recordings/after/audio')
})

test('a manually chosen story-focus category survives remount and note editing until Suggested is chosen explicitly', async () => {
  let active = { ...storyFocus, skill: 'emphasis', skill_label: 'Meaning through emphasis' }
  const source = { ...savedAttempt, reflection: { note: active.note, updated_at: 'before' } }
  let posts = 0
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(source)
    if (path === '/api/v1/practice-focus') {
      if (init?.method === 'POST') {
        const payload = JSON.parse(String(init.body))
        expect(payload.skill).toBe(posts++ === 0 ? 'emphasis' : undefined)
        active = { ...active, note: payload.note, skill: payload.skill ?? 'pace' }
        source.reflection.note = payload.note
        return Response.json({ focus: active, source_attempt: source }, { status: 201 })
      }
      return Response.json({ focus: active, skills: {
        emphasis: { label: 'Meaning through emphasis', exercise_ids: ['E10'] },
        pace: { label: 'Comfortable pace', exercise_ids: ['E06'] },
      }, last_check: null })
    }
  })
  open('/exercise/item')
  const category = await screen.findByRole('combobox', { name: 'Focus for story practice' }) as HTMLSelectElement
  await waitFor(() => expect(category.value).toBe('emphasis'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this stress choice comfortable.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save for story practice' }))
  await waitFor(() => expect(posts).toBe(1))
  await screen.findByText('Saved for story practice and your next session.')
  fireEvent.change(category, { target: { value: '' } })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Try the exercise default this time.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save for story practice' }))
  await waitFor(() => expect(posts).toBe(2))
  expect(active.skill).toBe('pace')
})

test.each(['focus-check', 'reflection'])('a late %s save updates its take without changing the selected history entry', async (operation) => {
  let first = { ...savedAttempt, training_focus: storyFocus, practice_only: false, feedback: { summary: 'Take A feedback.', issues: [] }, reflection: { note: 'Original note.', updated_at: 'before' }, focus_check: undefined as { outcome: string; source: string; updated_at: string } | undefined }
  const second = { ...first, id: 'second', recording_id: 'second-recording', practice_only: true, feedback: { summary: 'Take B feedback.', issues: [] } }
  let release!: (response: Response) => void
  const delayed = new Promise<Response>((resolve) => { release = resolve })
  setup({ ...baseItem, exercise_id: 'E12' }, (path) => {
    if (path === '/api/v1/exercise-attempts/attempt/' + operation) return delayed
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(first)
    if (path === '/api/v1/exercise-attempts?plan_item_id=item&limit=20') return Response.json({ items: [first, second], next_cursor: null })
    if (path === '/api/v1/recordings/second-recording') return Response.json({ audio_url: '/api/v1/recordings/second-recording/audio' })
    if (path === '/api/v1/exercise-attempts/second') return Response.json(second)
  })
  open('/exercise/item')
  await screen.findByText('Take A feedback.')
  if (operation === 'focus-check') fireEvent.click(screen.getByRole('button', { name: 'Partly' }))
  else {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A saved note.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }))
  }
  fireEvent.click(screen.getByRole('button', { name: 'Extra practice · saved' }))
  await screen.findByText('Take B feedback.')
  first = operation === 'focus-check' ? { ...first, focus_check: { outcome: 'partly', source: 'user_listening', updated_at: 'now' } } : { ...first, reflection: { note: 'A saved note.', updated_at: 'now' } }
  await act(async () => release(Response.json(first)))
  expect(screen.getByText('Take B feedback.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Extra practice · saved' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'First completion attempt · saved' }))
  await screen.findByText('Take A feedback.')
  if (operation === 'focus-check') expect(screen.getByRole('button', { name: 'Partly' }).getAttribute('aria-pressed')).toBe('true')
  else expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('A saved note.')
})

test('keeping a useful feature survives a failed focus save and reload without copying the AI idea', async () => {
  const note = 'Keep the gap after bridge so the next idea starts separately.'
  let original = { ...savedAttempt, reflection: { note: '', updated_at: '', intent: undefined as 'keep' | undefined },
    speech_review: { status: 'completed', job_id: null, report: { summary: 'The thoughts have room.', observation: null,
      next_step: 'Make the pause longer.', listening_question: 'Can you follow the thoughts?', limitations: ['One take only.'] } } }
  let active: TrainingFocus | null = null
  const keys: string[] = []
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(original)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
    if (path === '/api/v1/practice-focus') {
      if (init?.method === 'POST') {
        keys.push(String((init.headers as Record<string, string>)['Idempotency-Key']))
        const payload = JSON.parse(String(init.body))
        expect(payload.intent).toBe('keep')
        expect(payload.note).toBe(note)
        if (keys.length === 1) return Response.json({ error: { message: 'Focus save offline.' } }, { status: 503 })
        active = { ...storyFocus, note, intent: 'keep', skill: 'pace' }
        original = { ...original, reflection: { note, intent: 'keep', updated_at: 'now' } }
        return Response.json({ focus: active, source_attempt: original }, { status: 201 })
      }
      return Response.json({ focus: active, skills: { pace: { label: 'Comfortable pace', exercise_ids: ['E06'] } }, last_check: null })
    }
  })
  const view = open('/exercise/item')
  await screen.findByText('Make the pause longer.')
  expect(screen.queryByRole('button', { name: 'Use suggested change' })).toBeNull()
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  fireEvent.click(screen.getByRole('radio', { name: 'Keep a useful feature' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: note } })
  fireEvent.click(screen.getByRole('button', { name: 'Save for story practice' }))
  await screen.findByText('Focus save offline.')
  expect((screen.getByRole('radio', { name: 'Keep a useful feature' }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(note)
  fireEvent.click(screen.getByRole('button', { name: 'Save for story practice' }))
  await screen.findByText('Saved for story practice and your next session.')
  expect(screen.queryByText('Make the pause longer.')).toBeNull()
  expect(screen.getByText('Your listening step:')).toBeTruthy()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(keys[0]).toBe(keys[1])
  view.unmount()
  open('/exercise/item')
  await screen.findByText('Saved for story practice and your next session.')
  expect(screen.queryByText('Make the pause longer.')).toBeNull()
  expect(screen.getByText('Your listening step:')).toBeTruthy()
  expect((screen.getByRole('radio', { name: 'Keep a useful feature' }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(note)
})

test('an undecided listening note can be empty and survives reload without replacing an existing focus', async () => {
  let original = { ...savedAttempt, reflection: { note: '', updated_at: '', intent: undefined as 'undecided' | undefined } }
  let focusPosts = 0
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/exercise-attempts/attempt/reflection') {
      expect(JSON.parse(String(init?.body))).toEqual({ note: '', intent: 'undecided', expected_revision: 0 })
      original = { ...original, reflection: { note: '', intent: 'undecided', updated_at: 'now' } }
      return Response.json(original)
    }
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(original)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
    if (path === '/api/v1/practice-focus') {
      if (init?.method === 'POST') focusPosts++
      return Response.json({ focus: storyFocus, skills: {}, last_check: null })
    }
  })
  const view = open('/exercise/item')
  fireEvent.click(await screen.findByRole('radio', { name: 'Listen again before deciding' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }))
  await screen.findByText('Reflection saved with this take.')
  expect(screen.queryByRole('button', { name: 'Save for story practice' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Practice again — no extra notes' })).toBeTruthy()
  await screen.findByText(/Your existing story focus stays in place/)
  view.unmount()
  open('/exercise/item')
  await waitFor(() => expect((screen.getByRole('radio', { name: 'Listen again before deciding' }) as HTMLInputElement).checked).toBe(true))
  expect(screen.queryByRole('button', { name: 'Save for story practice' })).toBeNull()
  expect(focusPosts).toBe(0)
})

test.each([['keep', 'experiment'], ['experiment', 'keep']] as const)('repeat comparison uses current %s intention over previous %s and corrects old local advice', async (currentIntent, previousIntent) => {
  const extra = { ...savedAttempt, id: 'extra', practice_only: true,
    practice_focus: { attempt_id: 'attempt', note: 'A previous reflection.', intent: previousIntent },
    training_focus: { ...storyFocus, intent: currentIntent },
    feedback: { ...savedAttempt.feedback, next_step: 'Keep this pace and change the emphasis on a word.' } }
  setup({ ...baseItem, exercise_id: 'E12' }, (path) => {
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [extra, savedAttempt], next_cursor: null })
    if (path === '/api/v1/exercise-attempts/extra') return Response.json(extra)
  })
  open('/exercise/item')
  await screen.findByLabelText('Previous take for comparison')
  if (currentIntent === 'keep') {
    expect(screen.getByText('You chose to keep a useful feature for this take.')).toBeTruthy()
    expect(screen.getByText(/Listen for the feature you wanted to keep/)).toBeTruthy()
    expect(screen.queryByText('Keep this pace and change the emphasis on a word.')).toBeNull()
  } else expect(screen.queryByText('You chose to keep a useful feature for this take.')).toBeNull()
  expect(screen.getByText('Optional practice idea:')).toBeTruthy()
  expect(screen.queryByText('Try next:')).toBeNull()
})

const pauseExample = {
  id: 'pause-example-v1', version: 'v1', title: 'Hear where a pause falls', source: 'synthetic' as const,
  text: 'At the old bridge the path turns toward the river.', question: 'Which version keeps the group together?',
  explanation: 'A keeps the words together; B separates the article.', transfer_prompt: 'Choose one boundary to listen for.',
  provenance_note: 'Synthesized comparison, not a target voice.', notice_url: '/practice-examples/NOTICE.txt',
  choices: [{ id: 'a' as const, label: 'A', audio_url: '/practice-examples/a.wav', paused_text: 'At the old bridge / the path turns.' }, { id: 'b' as const, label: 'B', audio_url: '/practice-examples/b.wav', paused_text: 'At the / old bridge the path turns.' }],
}
const pauseBoundaries = [{ index: 0, before: 'The first thought', after: 'the second thought', word_index: 2 }, { index: 1, before: 'the second thought', after: 'the ending', word_index: 5 }]
const plannedPause = { id: 'listening-a', plan_item_id: 'item', created_at: '2026-11-15T00:00:00Z', example: pauseExample, answer: 'a' as const, boundary_index: 0, boundary_word_index: 2, before: 'The first thought', after: 'the second thought' }

test('a listening comparison remains optional after audio failure and saves an owned boundary with retry identity', async () => {
  const item = { ...baseItem, exercise_id: 'E08', status: 'pending' as const, latest_attempt_id: null }
  const state = { item, lesson: { id: 'lesson', items: [item] }, plan_status: 'active', item_index: 0, pending_take: null, listening_example: pauseExample, listening_boundaries: pauseBoundaries, listening_plan: null }
  let persisted: unknown = null
  const keys: string[] = []
  setup(item, (path, init) => {
    if (path === '/api/v1/plan-items/item') return Response.json({ ...state, listening_plan: persisted })
    if (path.endsWith('/listening-plan')) {
      keys.push(String((init?.headers as Record<string, string>)['Idempotency-Key']))
      expect(JSON.parse(String(init?.body))).toEqual({ example_id: pauseExample.id, answer: 'unsure', boundary_index: 0 })
      if (keys.length === 1) return Response.json({ error: { message: 'Boundary save offline.' } }, { status: 503 })
      persisted = { ...plannedPause, answer: 'unsure' }
      return Response.json(persisted, { status: 201 })
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  open('/exercise/item', client)
  fireEvent.click(await screen.findByText('Listen to a short pause comparison'))
  fireEvent.error(screen.getByLabelText('Pause example A'))
  expect(screen.getByText(/The examples could not load/)).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Start recording' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('radio', { name: 'Not sure' }))
  fireEvent.click(screen.getByRole('radio', { name: 'The first thought / the second thought' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use this boundary for my take' }))
  await screen.findByText('Boundary save offline.')
  fireEvent.click(screen.getByRole('button', { name: 'Use this boundary for my take' }))
  await screen.findByRole('heading', { name: 'Boundary for this take' })
  expect(keys).toHaveLength(2)
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(keys[1]).toBe(keys[0])
  act(() => client.setQueryData(['plan-item', 'item'], { ...state, listening_plan: { ...plannedPause, answer: 'b', boundary_index: 1 } }))
  await waitFor(() => expect((screen.getByRole('radio', { name: 'Version B' }) as HTMLInputElement).checked).toBe(true))
  expect((screen.getByRole('radio', { name: 'the second thought / the ending' }) as HTMLInputElement).checked).toBe(true)
})

test('a started take keeps its chosen boundary when another tab saves a new one', async () => {
  const blob = new Blob(['take'])
  vi.spyOn(recorder, 'useRecorder').mockImplementation(() => {
    const [state, setState] = useState<'idle' | 'recording' | 'recorded'>('idle')
    return { state, level: { level: 0, status: 'waiting' }, seconds: 10, error: null, limitReached: false,
      mime: state === 'recorded' ? 'audio/webm' : null, blob: state === 'recorded' ? blob : null, url: state === 'recorded' ? 'blob:take' : null,
      start: async () => { setState('recording') }, stop: () => setState('recorded'), reset: () => setState('idle') }
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const item = { ...baseItem, exercise_id: 'E08', status: 'pending' as const, latest_attempt_id: null }
  const state = { item, lesson: { id: 'lesson', items: [item] }, plan_status: 'active', item_index: 0, pending_take: null, listening_example: pauseExample, listening_boundaries: pauseBoundaries, listening_plan: plannedPause }
  let sent: string | null = null
  setup(item, (path, init) => {
    if (path === '/api/v1/plan-items/item') return Response.json(state)
    if (path === '/api/v1/recordings') { sent = String((init?.body as FormData).get('listening_plan_id')); return Response.json({ error: { message: 'Stop after boundary probe.' } }, { status: 503 }) }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  open('/exercise/item', client)
  fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
  await screen.findByRole('button', { name: 'Stop recording' })
  act(() => client.setQueryData(['plan-item', 'item'], { ...state, listening_plan: { ...plannedPause, id: 'listening-b', boundary_index: 1, before: 'A future boundary', after: 'for another take' } }))
  expect(screen.queryByText(/A future boundary/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check my take' }))
  await screen.findByText('Stop after boundary probe.')
  expect(sent).toBe(plannedPause.id)
})

test('saved chosen-boundary timing and private evidence playback survive exercise reload', async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const saved = { ...savedAttempt, listening_plan: plannedPause, feedback: { ...savedAttempt.feedback, planned_pause: { available: true, gap_seconds: 0.7, evidence: { quote: 'thought … the', start_seconds: 2, end_seconds: 4 } } } }
  setup({ ...baseItem, exercise_id: 'E08' }, (path) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(saved)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [saved], next_cursor: null })
  })
  open('/exercise/item')
  await screen.findByText(/About 0.7 seconds between the recognized words/)
  fireEvent.click(await screen.findByRole('button', { name: 'Hear your chosen boundary: “thought … the”' }))
  expect((screen.getByLabelText('Your completed take') as HTMLAudioElement).currentTime).toBe(2)
  expect(play).toHaveBeenCalledOnce()
})

test('a locked task is a readable preview and only offers recording after availability is refreshed', async () => {
  const item = { ...baseItem, status: 'pending' as const, latest_attempt_id: null }
  let lessonStatus = 'locked'
  const transport = setup(item, (path) => {
    if (path === '/api/v1/plan-items/item') return Response.json({ item, lesson: { id: 'lesson', status: lessonStatus, items: [item] }, plan_status: 'active', item_index: 0, pending_take: null })
  })
  open('/exercise/item')
  await screen.findByRole('heading', { name: 'Session not open yet' })
  expect(screen.getByText(item.task.text)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Check my take' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Back to today' }).getAttribute('href')).toBe('/today')
  lessonStatus = 'available'
  fireEvent.click(screen.getByRole('button', { name: 'Check availability' }))
  await screen.findByRole('button', { name: 'Start recording' })
  expect(screen.queryByRole('heading', { name: 'Session not open yet' })).toBeNull()
  expect(transport.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})

test('an unfinished archived task stays a preview while its completed neighbor retains extra practice', async () => {
  const pending = { ...baseItem, status: 'pending' as const, latest_attempt_id: null }
  let current = pending as PlanItem
  setup(pending, (path) => {
    if (path === '/api/v1/plan-items/item') return Response.json({ item: current, lesson: { id: 'lesson', status: 'locked', items: [current] }, plan_status: 'archived', item_index: 0, pending_take: null })
  })
  const view = open('/exercise/item')
  await screen.findByRole('heading', { name: 'Saved task preview' })
  expect(screen.queryByRole('button', { name: 'Check availability' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull()
  view.unmount()
  current = baseItem
  open('/exercise/item')
  await screen.findByText('Recording received. Audio quality checked.')
  fireEvent.click(screen.getByRole('button', { name: 'Practice again — no extra notes' }))
  await screen.findByRole('button', { name: 'Start recording' })
  expect(screen.queryByRole('heading', { name: 'Saved task preview' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Session not open yet' })).toBeNull()
})

test.each(['processing', 'completed'])('a newly discovered %s take restores its own boundary and saved job without reloading', async (status) => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const item = { ...baseItem, exercise_id: 'E08', status: 'pending' as const, latest_attempt_id: null }
  const initial = { item, lesson: { id: 'lesson', items: [item] }, plan_status: 'active', item_index: 0, pending_take: null, listening_example: pauseExample, listening_boundaries: pauseBoundaries, listening_plan: plannedPause }
  const remote = { recording_id: 'remote-recording', job_id: 'remote-job', status, practice_only: false, listening_plan: plannedPause }
  let polls = 0
  let saves = 0
  setup(item, (path, init) => {
    if (path === '/api/v1/plan-items/item') return Response.json(initial)
    if (path === '/api/v1/jobs/remote-job') { polls++; return Response.json({ status, poll_after_ms: 100000 }) }
    if (path === '/api/v1/exercise-attempts') {
      saves++
      expect(JSON.parse(String(init?.body))).toEqual({ plan_item_id: 'item', recording_id: 'remote-recording' })
      return Response.json({ ...savedAttempt, listening_plan: plannedPause }, { status: 201 })
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  open('/exercise/item', client)
  await screen.findByRole('button', { name: 'Start recording' })
  act(() => client.setQueryData(['plan-item', 'item'], { ...initial, pending_take: remote, listening_plan: { ...plannedPause, id: 'future-b', before: 'Future selection', after: 'for another take' } }))
  await waitFor(() => expect(polls).toBeGreaterThan(0))
  expect(screen.queryByText(/Future selection/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull()
  if (status === 'processing') {
    await screen.findByText('Checking your saved take. You can return here after leaving this page.')
    expect(saves).toBe(0)
  } else {
    await screen.findByRole('heading', { name: 'Practice complete' })
    expect(saves).toBe(1)
  }
})

test('a remote take waits for the local recording to be explicitly discarded and cannot replace its source or boundary', async () => {
  const blob = new Blob(['local recording'])
  vi.spyOn(recorder, 'useRecorder').mockImplementation(() => {
    const [state, setState] = useState<'idle' | 'recording' | 'recorded'>('idle')
    return { state, level: { level: 0, status: 'waiting' }, seconds: 5, error: null, limitReached: false,
      mime: state === 'recorded' ? 'audio/webm' : null, blob: state === 'recorded' ? blob : null, url: state === 'recorded' ? 'blob:local' : null,
      start: async () => { setState('recording') }, stop: () => setState('recorded'), reset: () => setState('idle') }
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const item = { ...baseItem, exercise_id: 'E08' }
  const initial = { item, lesson: { id: 'lesson', items: [item] }, plan_status: 'active', item_index: 0, pending_take: null, listening_example: pauseExample, listening_boundaries: pauseBoundaries, listening_plan: plannedPause }
  let submitted: { plan: FormDataEntryValue | null; source: FormDataEntryValue | null } | undefined
  let polls = 0
  setup(item, (path, init) => {
    if (path === '/api/v1/plan-items/item') return Response.json(initial)
    if (path === '/api/v1/jobs/remote-job') { polls++; return Response.json({ status: 'processing', poll_after_ms: 100000 }) }
    if (path === '/api/v1/recordings') {
      const form = init?.body as FormData
      submitted = { plan: form.get('listening_plan_id'), source: form.get('based_on_attempt_id') }
      return Response.json({ error: { message: 'Local recording preserved.' } }, { status: 503 })
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  open('/exercise/item', client)
  await screen.findByText('Recording received. Audio quality checked.')
  fireEvent.click(await screen.findByRole('button', { name: 'Practice again — no extra notes' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
  await screen.findByRole('button', { name: 'Stop recording' })
  const later = { ...plannedPause, id: 'later-b', before: 'Remote boundary', after: 'for the remote take' }
  act(() => client.setQueryData(['plan-item', 'item'], { ...initial, listening_plan: later, pending_take: { recording_id: 'remote-recording', job_id: 'remote-job', status: 'processing', practice_only: true, based_on_attempt_id: 'remote-source', listening_plan: later } }))
  expect(polls).toBe(0)
  expect(screen.queryByText(/Remote boundary/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check my take' }))
  await screen.findByText('Local recording preserved.')
  expect(submitted).toEqual({ plan: plannedPause.id, source: 'attempt' })
  expect(polls).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Record again' }))
  await screen.findByText('Checking your saved take. You can return here after leaving this page.')
  expect(polls).toBeGreaterThan(0)
  expect(screen.getByText(/Remote boundary/)).toBeTruthy()
})

test('an old save receipt is reconciled with a newer server boundary and remains consistent after reload', async () => {
  const item = { ...baseItem, exercise_id: 'E08', status: 'pending' as const, latest_attempt_id: null }
  const later = { ...plannedPause, id: 'later-b', answer: 'b' as const, boundary_index: 1, before: 'the second thought', after: 'the ending' }
  let persisted: typeof plannedPause | typeof later | null = null
  const state = () => ({ item, lesson: { id: 'lesson', items: [item] }, plan_status: 'active', item_index: 0, pending_take: null, listening_example: pauseExample, listening_boundaries: pauseBoundaries, listening_plan: persisted })
  const keys: string[] = []
  setup(item, (path, init) => {
    if (path === '/api/v1/plan-items/item') return Response.json(state())
    if (path.endsWith('/listening-plan')) {
      keys.push(String((init?.headers as Record<string, string>)['Idempotency-Key']))
      if (keys.length === 1) { persisted = plannedPause; return Response.json({ error: { message: 'Response lost after commit.' } }, { status: 503 }) }
      return Response.json(plannedPause, { status: 201 })
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const view = open('/exercise/item', client)
  fireEvent.click(await screen.findByText('Listen to a short pause comparison'))
  fireEvent.click(screen.getByRole('radio', { name: 'Version A' }))
  fireEvent.click(screen.getByRole('radio', { name: 'The first thought / the second thought' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use this boundary for my take' }))
  await screen.findByText('Response lost after commit.')
  persisted = later
  await act(async () => { await client.invalidateQueries({ queryKey: ['plan-item', 'item'] }) })
  fireEvent.click(screen.getByRole('button', { name: 'Use this boundary for my take' }))
  await screen.findByText('A newer boundary was saved elsewhere. The latest saved boundary is shown below.')
  expect((client.getQueryData(['plan-item', 'item']) as { listening_plan: { id: string } }).listening_plan.id).toBe(later.id)
  expect((screen.getByRole('radio', { name: 'Version B' }) as HTMLInputElement).checked).toBe(true)
  const before = screen.getByLabelText('Your chosen boundary').textContent
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  view.unmount()
  open('/exercise/item')
  await screen.findByRole('heading', { name: 'Boundary for this take' })
  expect(screen.getByLabelText('Your chosen boundary').textContent).toBe(before)
})

test.each(['keep', 'undecided'] as const)('a saved %s decision governs old AI advice while the recorded objective stays frozen', async (intent) => {
  const modelIdea = "Try a pause before shook hands."
  const modelQuestion = 'Did your new pause make the action stand out?'
  const original = { ...savedAttempt, training_focus: { ...storyFocus, intent: 'experiment' as const }, reflection: { note: '', updated_at: 'now', intent },
    speech_review: { status: 'completed', job_id: null, report: { summary: 'A model impression.', observation: { text: 'The words seem connected.', evidence: { quote: 'a calm', start_seconds: 0, end_seconds: 1 } }, next_step: modelIdea, listening_question: modelQuestion, limitations: ['One take only.'] } } }
  setup({ ...baseItem, exercise_id: 'E12' }, (path) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(original)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
  })
  open('/exercise/item')
  await screen.findByText('Listening hypothesis')
  expect(screen.getByText('AI impressions need your listening check. They do not score this take.')).toBeTruthy()
  expect(screen.getByText('Your listening step:')).toBeTruthy()
  expect(screen.queryByText('For future practice, explore a gentler pace.')).toBeNull()
  expect(screen.getByText('This take counts. The pace band is an optional drill target.')).toBeTruthy()
  expect(screen.queryByText(modelIdea)).toBeNull()
  expect(screen.queryByText(modelQuestion)).toBeNull()
  if (intent === 'undecided') expect(screen.getByText('What do you hear in this phrase, and is there enough reason to choose a change?')).toBeTruthy()
  else expect(screen.getByText('Can you hear the useful feature you chose to keep, without needing to make it stronger?')).toBeTruthy()
  expect(screen.getByText(storyFocus.note)).toBeTruthy() // The recorded story objective remains its original snapshot.
})

test('an explicit experiment restores the original optional model idea from an earlier keep policy', async () => {
  const original = { ...savedAttempt, training_focus: { ...storyFocus, intent: 'keep' as const }, reflection: { note: '', updated_at: 'now', intent: 'experiment' as const },
    speech_review: { status: 'completed', job_id: null, report: { summary: 'An impression to check.', observation: null,
      next_step: 'Old keep policy action.', listening_question: 'Old keep policy question.', model_next_step: 'Try the original optional idea.', model_listening_question: 'What happened in this take?', action_intent: 'keep', limitations: ['One take only.'] } } }
  setup(baseItem, (path) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(original)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
  })
  open('/exercise/item')
  await screen.findByText('Try the original optional idea.')
  expect(screen.getByText('What happened in this take?')).toBeTruthy()
  expect(screen.queryByText('Old keep policy action.')).toBeNull()
  expect(screen.getByText('Optional idea:')).toBeTruthy()
})

test('a fresh detail GET updates every listening block and note-only saving never resends an old intention', async () => {
  const old = { ...savedAttempt, reflection: { note: 'Earlier note.', intent: 'experiment' as const, updated_at: '2026-11-15T10:00:00.000001Z' },
    training_focus: { ...storyFocus, intent: 'experiment' as const }, feedback: { ...savedAttempt.feedback, next_step: 'OLD_LOCAL_CHANGE' },
    speech_review: { status: 'completed', job_id: null, report: { summary: 'An impression.', observation: null, next_step: 'OLD_MODEL_CHANGE', listening_question: 'OLD_MODEL_QUESTION', limitations: [] } } }
  let current = { ...old, reflection: { note: 'Listen first.', intent: 'undecided' as 'undecided' | 'experiment', updated_at: '2026-11-15T10:00:00.000002Z' } }
  let release!: (response: Response) => void
  const delayed = new Promise<Response>((resolve) => { release = resolve })
  let sent: Record<string, unknown> | undefined
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/exercise-attempts/attempt') return delayed
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [old], next_cursor: null })
    if (path.endsWith('/reflection')) {
      sent = JSON.parse(String(init?.body))
      current = { ...current, reflection: { ...current.reflection, note: String(sent!.note) } }
      return Response.json(current)
    }
  })
  open('/exercise/item')
  await screen.findByText('OLD_MODEL_CHANGE')
  await act(async () => release(Response.json(current)))
  await waitFor(() => expect((screen.getByRole('radio', { name: 'Listen again before deciding' }) as HTMLInputElement).checked).toBe(true))
  expect((screen.getByRole('textbox', { name: 'Your listening note' }) as HTMLTextAreaElement).value).toBe('Listen first.')
  expect(screen.queryByText('OLD_LOCAL_CHANGE')).toBeNull()
  expect(screen.queryByText('OLD_MODEL_CHANGE')).toBeNull()
  expect(screen.queryByText('For future practice, explore a gentler pace.')).toBeNull()
  expect(screen.getByText(storyFocus.note)).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: 'Your listening note' }), { target: { value: 'Edited only my note.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }))
  await screen.findByText('Reflection saved with this take.')
  expect(sent).toEqual({ note: 'Edited only my note.', expected_revision: 0 })
  expect(current.reflection.intent).toBe('undecided')
})

test.each(['disjoint', 'same_note', 'same_intent'] as const)('a %s update while editing preserves the draft and resolves only overlapping fields', async (scenario) => {
  const original: Attempt = { ...savedAttempt, reflection: { note: 'Original note.', intent: 'experiment', revision: 1, updated_at: '2026-11-15T10:00:00Z' } }
  const incoming: Attempt = { ...original, reflection: { note: scenario === 'same_note' ? 'Remote note.' : 'Original note.', intent: 'undecided', revision: 2, updated_at: '2026-11-15T10:00:01Z' } }
  let current = original
  const bodies: Record<string, unknown>[] = []
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(current)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
    if (path.endsWith('/reflection')) {
      const body = JSON.parse(String(init?.body)); bodies.push(body)
      current = { ...current, reflection: { ...current.reflection!, note: body.note, intent: body.intent ?? current.reflection!.intent, revision: 3 } }
      return Response.json(current)
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  open('/exercise/item', client)
  await screen.findByDisplayValue('Original note.')
  if (scenario === 'same_intent') fireEvent.click(screen.getByRole('radio', { name: 'Keep a useful feature' }))
  else fireEvent.change(screen.getByRole('textbox', { name: 'Your listening note' }), { target: { value: 'My draft note.' } })
  current = incoming
  act(() => client.setQueryData(['attempt', 'attempt'], incoming))
  if (scenario === 'disjoint') {
    expect(screen.queryByText('A saved reflection changed while you were editing. Your draft is kept.')).toBeNull()
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Listen again before deciding' }) as HTMLInputElement).checked).toBe(true))
  } else {
    await screen.findByText('A saved reflection changed while you were editing. Your draft is kept.')
    expect((screen.getByRole('button', { name: 'Save reflection' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Keep my draft for the next save' }))
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }))
  await screen.findByText('Reflection saved with this take.')
  expect(bodies).toEqual([{ note: scenario === 'same_intent' ? 'Original note.' : 'My draft note.', expected_revision: 2, ...(scenario === 'same_intent' ? { intent: 'keep' } : {}) }])
  expect(current.reflection?.intent).toBe(scenario === 'same_intent' ? 'keep' : 'undecided')
})

test('a server version conflict returns the current reflection without losing a draft or retrying an old choice', async () => {
  const original: Attempt = { ...savedAttempt, reflection: { note: 'Original note.', intent: 'experiment', revision: 0, updated_at: '2026-11-15T10:00:00Z' } }
  let current: Attempt = { ...original, reflection: { note: 'Changed in another tab.', intent: 'undecided', revision: 1, updated_at: '2026-11-15T10:00:01Z' } }
  const bodies: Record<string, unknown>[] = []
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(original)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
    if (path.endsWith('/reflection')) {
      const body = JSON.parse(String(init?.body)); bodies.push(body)
      if (bodies.length === 1) return Response.json({ error: { code: 'reflection_changed', message: 'The saved reflection changed.', details: { current_attempt: current } } }, { status: 409 })
      current = { ...current, reflection: { ...current.reflection!, note: body.note, revision: 2 } }
      return Response.json(current)
    }
  })
  open('/exercise/item')
  await screen.findByDisplayValue('Original note.')
  fireEvent.change(screen.getByRole('textbox', { name: 'Your listening note' }), { target: { value: 'My retained draft.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }))
  await screen.findByText('A saved reflection changed while you were editing. Your draft is kept.')
  expect((screen.getByRole('textbox', { name: 'Your listening note' }) as HTMLTextAreaElement).value).toBe('My retained draft.')
  expect((screen.getByRole('radio', { name: 'Listen again before deciding' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Keep my draft for the next save' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }))
  await screen.findByText('Reflection saved with this take.')
  expect(bodies).toEqual([{ note: 'My retained draft.', expected_revision: 0 }, { note: 'My retained draft.', expected_revision: 1 }])
})

test('a retried old focus receipt refreshes the current pointer and retains a conflicting draft', async () => {
  const original: Attempt = { ...savedAttempt, reflection: { note: 'Original note.', intent: 'experiment', revision: 0, updated_at: '2026-11-15T10:00:00Z' } }
  let current = original
  let active: TrainingFocus | null = null
  let receipt: { focus: TrainingFocus; source_attempt: Attempt }
  const keys: string[] = []
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(current)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
    if (path === '/api/v1/practice-focus') {
      if (init?.method === 'POST') {
        keys.push(String((init.headers as Record<string, string>)['Idempotency-Key']))
        if (keys.length === 1) {
          active = { ...storyFocus, id: 'focus-a', note: 'My focus draft.', intent: 'keep', skill: 'pace' }
          current = { ...original, reflection: { note: 'My focus draft.', intent: 'keep', revision: 1, updated_at: '2026-11-15T10:00:01Z' } }
          receipt = { focus: active, source_attempt: current }
          return Response.json({ error: { message: 'Response lost after commit.' } }, { status: 503 })
        }
        return Response.json(receipt, { status: 201 })
      }
      return Response.json({ focus: active, skills: { pace: { label: 'Comfortable pace', exercise_ids: ['E06'] } }, last_check: null })
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  open('/exercise/item', client)
  await screen.findByDisplayValue('Original note.')
  fireEvent.change(screen.getByRole('textbox', { name: 'Your listening note' }), { target: { value: 'My focus draft.' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Keep a useful feature' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save for story practice' }))
  await screen.findByText('Response lost after commit.')
  // A refetch first reveals our own committed revision, then the external edit happens before retry.
  act(() => client.setQueryData(['attempt', 'attempt'], current))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save reflection' }) as HTMLButtonElement).disabled).toBe(true))
  active = { ...storyFocus, id: 'focus-b', source_attempt_id: 'another-source', note: 'A newer active focus.' }
  current = { ...original, reflection: { note: 'A newer note.', intent: 'undecided', revision: 2, updated_at: '2026-11-15T10:00:02Z' } }
  fireEvent.click(screen.getByRole('button', { name: 'Save for story practice' }))
  await screen.findByText('A saved reflection changed while you were editing. Your draft is kept.')
  await screen.findByRole('link', { name: 'Review the current focus before your next story.' })
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect((client.getQueryData(['practice-focus']) as { focus: TrainingFocus }).focus.id).toBe('focus-b')
  expect((screen.getByRole('textbox', { name: 'Your listening note' }) as HTMLTextAreaElement).value).toBe('My focus draft.')
  expect((screen.getByRole('radio', { name: 'Keep a useful feature' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Use saved reflection' }))
  expect((screen.getByRole('textbox', { name: 'Your listening note' }) as HTMLTextAreaElement).value).toBe('A newer note.')
  expect((screen.getByRole('radio', { name: 'Listen again before deciding' }) as HTMLInputElement).checked).toBe(true)
})


test('a late successful save cannot replace a newer reflection or discard its conflicting local draft', async () => {
  const original: Attempt = { ...savedAttempt, training_focus: storyFocus,
    reflection: { note: 'Original note.', intent: 'experiment', revision: 1, updated_at: '2026-11-15T10:00:00Z' } }
  const own: Attempt = { ...original, reflection: { note: 'My delayed save.', intent: 'experiment', revision: 2, updated_at: '2026-11-15T10:00:01Z' } }
  const latest: Attempt = { ...original, reflection: { note: 'A newer saved note.', intent: 'undecided', revision: 3, updated_at: '2026-11-15T10:00:02Z' } }
  let release!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { release = resolve })
  setup(baseItem, (path) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(original)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
    if (path.endsWith('/reflection')) return pending
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  open('/exercise/item', client)
  await screen.findByDisplayValue('Original note.')
  fireEvent.change(screen.getByRole('textbox', { name: 'Your listening note' }), { target: { value: 'My delayed save.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save reflection' }))
  act(() => client.setQueryData(['attempt', 'attempt'], latest))
  await screen.findByText('A saved reflection changed while you were editing. Your draft is kept.')
  await act(async () => release(Response.json(own)))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Use saved reflection' }) as HTMLButtonElement).disabled).toBe(false))
  expect((client.getQueryData(['attempt', 'attempt']) as Attempt).reflection?.revision).toBe(3)
  expect((screen.getByRole('textbox', { name: 'Your listening note' }) as HTMLTextAreaElement).value).toBe('My delayed save.')
  expect((screen.getByRole('radio', { name: 'Listen again before deciding' }) as HTMLInputElement).checked).toBe(true)
  expect(screen.getByText(storyFocus.note)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Use saved reflection' }))
  expect((screen.getByRole('textbox', { name: 'Your listening note' }) as HTMLTextAreaElement).value).toBe('A newer saved note.')
})


test('a delayed old detail GET cannot replace a newer cached reflection before any local save', async () => {
  const original: Attempt = { ...savedAttempt, reflection: { note: 'Old note.', intent: 'experiment', revision: 1, updated_at: '2026-11-15T10:00:00Z' } }
  const latest: Attempt = { ...original, reflection: { note: 'Current saved note.', intent: 'undecided', revision: 2, updated_at: '2026-11-15T10:00:01Z' } }
  let release!: (response: Response) => void
  const delayed = new Promise<Response>((resolve) => { release = resolve })
  setup(baseItem, (path) => {
    if (path === '/api/v1/exercise-attempts/attempt') return delayed
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [original], next_cursor: null })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  open('/exercise/item', client)
  await screen.findByDisplayValue('Old note.')
  act(() => client.setQueryData(['attempt', 'attempt'], latest))
  await screen.findByDisplayValue('Current saved note.')
  await act(async () => release(Response.json(original)))
  await waitFor(() => expect(client.getQueryState(['attempt', 'attempt'])?.fetchStatus).toBe('idle'))
  expect((client.getQueryData(['attempt', 'attempt']) as Attempt).reflection?.revision).toBe(2)
  expect((screen.getByRole('radio', { name: 'Listen again before deciding' }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('textbox', { name: 'Your listening note' }) as HTMLTextAreaElement).value).toBe('Current saved note.')
})
