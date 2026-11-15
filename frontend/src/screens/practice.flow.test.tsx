// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import type { PlanItem, TrainingFocus } from '../api/types'
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
}
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
  expect(screen.getByText('AI listening notes can be mistaken. Check the observation against your own playback.')).toBeTruthy()
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
        expect(JSON.parse(String(init.body))).toEqual({ source_attempt_id: 'attempt', note: storyFocus.note, skill: 'pauses', intent: 'experiment' })
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
  expect(keys).toHaveLength(2)
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(keys[0]).toBe(keys[1])
  view.unmount()
  open('/exercise/item')
  await screen.findByText('Saved for story practice and your next session.')
  expect((screen.getByRole('radio', { name: 'Keep a useful feature' }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(note)
})

test('an undecided listening note can be empty and survives reload without replacing an existing focus', async () => {
  let original = { ...savedAttempt, reflection: { note: '', updated_at: '', intent: undefined as 'undecided' | undefined } }
  let focusPosts = 0
  setup(baseItem, (path, init) => {
    if (path === '/api/v1/exercise-attempts/attempt/reflection') {
      expect(JSON.parse(String(init?.body))).toEqual({ note: '', intent: 'undecided' })
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
