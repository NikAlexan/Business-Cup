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

vi.mock('../components/UpdateBanner', () => ({ UpdateBanner: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function open(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/" element={<Main />} />
    <Route path="/exercise/:planItemId" element={<Exercise />} />
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
      '/api/v1/me': { limits: { accepted_audio_types: ['audio/webm'], max_recording_seconds: 180 } },
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
  expect(body).toEqual({ plan_item_id: 'item', recording_id: 'extra-recording', practice_only: true })
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
