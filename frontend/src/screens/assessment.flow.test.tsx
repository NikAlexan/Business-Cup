// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import Analyzing from './Analyzing'
import Profile from './Profile'
import Record from './Record'

vi.mock('../components/UpdateBanner', () => ({ UpdateBanner: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const tasks = ['control_text', 'novel_text', 'intonation'].map((kind, index) => ({
  id: 'task-' + index, kind, order: index + 1, text: 'Script ' + kind, instruction: 'Read comfortably.',
  recording_id: 'recording-' + index, quality_status: 'accepted', max_duration_seconds: 60,
}))
const profile = {
  id: 'assessment', kind: 'initial', status: 'completed', job_id: 'analysis-job', tasks,
  measurements: {}, report: { summary: 'Test listening observation.', observations: [], priorities: [], limitations: ['Pace was unavailable for this take.'] },
  measurement_scope: { pace_and_pauses_task_ids: ['task-0', 'task-1'], pitch_task_ids: ['task-0', 'task-1'], intonation_task_ids: ['task-0', 'task-1'] },
}
function open(path: string, intercept: (path: string, init?: RequestInit) => unknown | Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    let data
    if (path === '/api/v1/me') data = { preferences: { timezone: 'UTC' }, progress: {}, limits: { accepted_audio_types: ['audio/webm'] } }
    else if (path === '/api/v1/exercises') data = { items: [] }
    else data = await intercept(path, init)
    if (!data) throw Error('Unexpected request: ' + path)
    return Response.json(data)
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/analyzing" element={<Analyzing />} />
    <Route path="/record" element={<Record />} />
    <Route path="/profile/:assessmentId" element={<Profile />} />
  </Routes></MemoryRouter></QueryClientProvider>)
}

test('completed baseline exposes saved limitations, source scripts and private audio', async () => {
  open('/profile/assessment', () => profile)
  await screen.findByText('Pace was unavailable for this take.')
  for (const [index, title] of ['Control passage', 'Unfamiliar passage', 'Expression task'].entries()) {
    expect(screen.getByLabelText(title + ' recording').getAttribute('src')).toBe('/api/v1/recordings/recording-' + index + '/audio')
  }
  fireEvent.click(screen.getByText('Which recordings were measured?'))
  expect(screen.getAllByText('Control passage · Unfamiliar passage')).toHaveLength(3)
  expect(screen.getByText('AI listening observations can be mistaken. Check them against your recordings; they are not a diagnosis.')).toBeTruthy()
})

test('failed analysis resumes from the recording route and retries its saved job without upload or submit', async () => {
  let retried = false
  let finished = false
  const mutations: string[] = []
  open('/record?assessment_id=assessment', (path, init) => {
    if (init?.method === 'POST') {
      mutations.push(path)
      expect(path).toBe('/api/v1/jobs/analysis-job/retry')
      retried = true
      return { job_id: 'analysis-job', status: 'queued', poll_after_ms: 10 }
    }
    if (path === '/api/v1/assessments/assessment') return { ...profile, status: finished ? 'completed' : retried ? 'processing' : 'failed' }
    if (path === '/api/v1/jobs/analysis-job') return {
      id: 'analysis-job', assessment_id: 'assessment', type: 'assessment_analysis',
      status: finished ? 'completed' : retried ? 'processing' : 'failed', stage: retried ? 'plan_generation' : 'failed',
      retryable: !retried, poll_after_ms: retried ? 10 : null, result: finished ? { assessment_id: 'assessment' } : null,
      error: retried ? null : { message: 'Provider unavailable.' },
    }
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Retry analysis' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Building your plan'))
  expect(screen.getAllByLabelText('Completed')).toHaveLength(3)
  finished = true
  await screen.findByText('Test listening observation.')
  expect(mutations).toEqual(['/api/v1/jobs/analysis-job/retry'])
})

test('analysis link restores its job from assessment metadata and reports a missing identifier', async () => {
  const view = open('/analyzing?assessment_id=assessment', (path) => path.includes('/jobs/')
    ? { id: 'analysis-job', assessment_id: 'assessment', status: 'failed', retryable: false, error: { message: 'Configuration unavailable.' } }
    : { ...profile, status: 'failed' })
  await screen.findByText('Configuration unavailable.')
  expect(screen.queryByRole('button', { name: 'Retry analysis' })).toBeNull()
  view.unmount()
  open('/analyzing', () => { throw Error('No request should be made without identifiers') })
  await screen.findByText('This link does not identify a saved analysis.')
})

test('a premature profile link routes to the saved analysis instead of showing empty result metrics', async () => {
  open('/profile/assessment', (path) => path.includes('/jobs/')
    ? { id: 'analysis-job', assessment_id: 'assessment', status: 'failed', retryable: true, error: { message: 'Retry the saved job.' } }
    : { ...profile, status: 'failed' })
  await screen.findByRole('button', { name: 'Retry analysis' })
  expect(screen.queryByText('Not measured')).toBeNull()
})

test('completed job waits for a fresh report before redirecting a stale profile again', async () => {
  let reads = 0
  let release!: (value: unknown) => void
  open('/profile/assessment', (path) => {
    if (path.includes('/jobs/')) return { id: 'analysis-job', assessment_id: 'assessment', status: 'completed', result: { assessment_id: 'assessment' } }
    if (++reads === 1) return { ...profile, status: 'processing' }
    return new Promise((resolve) => { release = resolve })
  })
  await waitFor(() => expect(reads).toBe(2))
  release(profile)
  await screen.findByText('Test listening observation.')
  expect(reads).toBe(2)
})

test('historical pause-share labels do not claim that pauses are well placed', async () => {
  open('/profile/assessment', () => ({ ...profile,
    measurements: { pause_ratio: { available: true, value: 0.2, unit: 'ratio', unavailable_reason: null } },
    interpretation: { pause_ratio: { band: 'within', target: { min: 0.14, max: 0.22 }, label: 'Well-placed pauses', note: '', focus: false } },
  }))
  await screen.findByText('Pause share in practice range')
  expect(screen.queryByText('Well-placed pauses')).toBeNull()
  expect(screen.getByText('Time in pauses does not measure where they fall. Listen back to judge the phrasing.')).toBeTruthy()
})
