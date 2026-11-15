// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Attempt, PracticeIntent } from '../api/types'
import { SpeechReview } from './SpeechReview'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const take: Attempt = { id: 'take', plan_item_id: 'item', status: 'passed', reward: { notes: 0, parts: [] }, practice_seconds: 3,
  feedback: { summary: 'Accepted.', issues: [] },
  speech_review: { status: 'completed', job_id: null, report: { summary: 'A saved impression.', observation: null,
    next_step: 'Try adding a new pause.', listening_question: 'Did the new pause work?', limitations: ['One take only.'] } } }

function withDecision(intent: PracticeIntent, updated_at: string): Attempt {
  return { ...take, reflection: { note: '', intent, updated_at } }
}

test.each([
  ['undecided', '2026-11-15T10:01:00Z', 'keep', '2026-11-15T10:00:00Z'],
  ['keep', '2026-11-15T10:00:00Z', 'undecided', '2026-11-15T10:01:00Z'],
  ['keep', '2026-11-15T10:00:00.000001Z', 'undecided', '2026-11-15T10:00:00.000002Z'],
] as const)('a refreshed %s/%s decision cannot displace the newer listening choice', async (shownIntent, shownAt, returnedIntent, returnedAt) => {
  let release!: (value: Response) => void
  const delayed = new Promise<Response>((resolve) => { release = resolve })
  vi.stubGlobal('fetch', vi.fn(async (url) => String(url).endsWith('/me') ? Response.json({ capabilities: {} }) : delayed))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  render(<QueryClientProvider client={client}><SpeechReview take={withDecision(shownIntent, shownAt)} onHear={vi.fn()} /></QueryClientProvider>)
  release(Response.json(withDecision(returnedIntent, returnedAt)))
  await waitFor(() => expect(client.getQueryData(['attempt', 'take'])).toBeTruthy())
  expect(screen.getByText('What do you hear in this phrase, and is there enough reason to choose a change?')).toBeTruthy()
  expect(screen.queryByText('Try adding a new pause.')).toBeNull()
})

test('a late queued GET cannot hide a completed report already returned by a successful save', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url) => String(url).endsWith('/me') ? Response.json({ capabilities: {} }) : Response.json({ ...take, speech_review: { status: 'queued', job_id: null, report: null } })))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  render(<QueryClientProvider client={client}><SpeechReview take={withDecision('undecided', '2026-11-15T10:01:00Z')} onHear={vi.fn()} /></QueryClientProvider>)
  await waitFor(() => expect(client.getQueryData(['attempt', 'take'])).toBeTruthy())
  expect(screen.getByText('A saved impression.')).toBeTruthy()
  expect(screen.getByText('Your listening step:')).toBeTruthy()
  expect(screen.queryByText(/Speech coaching is being prepared/)).toBeNull()
})
