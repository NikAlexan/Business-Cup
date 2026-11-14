// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import type { PlanItem } from '../api/types'
import * as recorder from '../lib/recorder'
import Exercise from './Exercise'
import Main from './Main'
import MicCheck from './MicCheck'
import Record from './Record'
import Home from './Home'
import Profile from './Profile'

vi.mock('../components/UpdateBanner', () => ({ UpdateBanner: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function open(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
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
function setup(item: PlanItem, intercept?: (path: string, init?: RequestInit) => Response | undefined) {
  const lesson = { id: 'lesson', items: [item] }
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const handled = intercept?.(path, init)
    if (handled) return handled
    const data: Record<string, unknown> = {
      '/api/v1/me': { preferences: { timezone: 'UTC' }, progress: { notes_total: 0, practice_seconds_total: 0, current_streak_days: 0 }, limits: { accepted_audio_types: ['audio/webm'], max_recording_seconds: 180 } },
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
  const reflection = await screen.findByRole('textbox', { name: 'What did you hear, and what will you try next?' })
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
  const extra = { ...savedAttempt, id: 'extra', practice_only: true, practice_focus: { attempt_id: 'attempt', note: 'Let the final word land.' },
    feedback: { ...savedAttempt.feedback, version: compatible ? 'speech-timing-feedback-v1' : 'older-timing',
      metrics: { speaking_rate_wpm: { available: true, value: 140, unit: 'words/min', unavailable_reason: null } } } }
  setup(baseItem, (path) => {
    if (path === '/api/v1/exercise-attempts/attempt') return Response.json(before)
    if (path.startsWith('/api/v1/exercise-attempts?')) return Response.json({ items: [extra, before], next_cursor: null })
  })
  open('/exercise/item')
  expect((await screen.findByLabelText('Previous take for comparison')).getAttribute('src')).toBe('/api/v1/recordings/recording/audio')
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
  const report = { summary: 'Listen to the phrase ending.', observation: { text: 'Check the final word.', evidence: { quote: 'clear message', start_seconds: 3, end_seconds: 5 } },
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
  expect(screen.getByRole('textbox', { name: 'What did you hear, and what will you try next?' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Practice again — no extra notes' })).toBeTruthy()
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
