// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { TakeListeningComparison } from '../api/types'
import { ListeningComparison } from './ListeningComparison'

const prepared: TakeListeningComparison = { id: 'pair', schema_version: 'take-listening-v1', purpose: 'self_listening', created_at: '2026-11-15T12:00:00Z',
  status: 'awaiting_choice', question: 'Can you hear the word endings comfortably?', text: 'A calm voice carries the ending.', focus_note: 'Keep the final sounds comfortable.', focus_changed: false,
  clips: [{ label: 'a', audio_url: '/api/v1/listening-comparisons/pair/audio/a' }, { label: 'b', audio_url: '/api/v1/listening-comparisons/pair/audio/b' }], result: null }
const revealed: TakeListeningComparison = { ...prepared, status: 'revealed',
  clips: prepared.clips.map((clip) => ({ ...clip, role: clip.label === 'a' ? 'current' : 'previous', attempt_id: clip.label === 'a' ? 'repeat' : 'first' })),
  result: { choice: 'unsure', note: '', source: 'user_listening', saved_at: '2026-11-15T12:01:00Z' } }

// jsdom has the dialog element but does not implement its native modal methods.
const nativeMethods = ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const)
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) } })
})
afterAll(() => { nativeMethods.forEach(([name, descriptor]) => { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name) }) })
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><ListeningComparison takeId="repeat" /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Compare with A/B labels' }))
}

test('A/B labels hide order until an optional unsure answer is saved, then reveal the saved result', async () => {
  const bodies: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const path = String(url)
    if (path.endsWith('/result')) { bodies.push(JSON.parse(init.body)); return Response.json(revealed) }
    return Response.json(prepared)
  }))
  open()
  const modal = await screen.findByRole('dialog', { name: 'Listen to your two takes' })
  await within(modal).findByText(prepared.question)
  expect(within(modal).queryByText('Version A · Repeated take')).toBeNull()
  expect(within(modal).queryByText('Version B · Previous take')).toBeNull()
  const save = within(modal).getByRole('button', { name: 'Save answer and reveal takes' })
  expect((save as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(modal).getByRole('radio', { name: 'I am not sure' }))
  fireEvent.click(save)
  await within(modal).findByRole('region', { name: 'Saved listening answer' })
  expect(bodies).toEqual([{ choice: 'unsure', note: '' }])
  expect(within(modal).getByText('Version A · Repeated take')).toBeTruthy()
  expect(within(modal).getByText('Version B · Previous take')).toBeTruthy()
  expect(within(modal).queryByRole('button', { name: 'Save answer and reveal takes' })).toBeNull()
})

test('a lost creation reply retries its key and reads authoritative revealed state instead of the old receipt', async () => {
  const keys: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'POST') {
      keys.push(init.headers['Idempotency-Key'])
      return keys.length === 1 ? Response.json({ error: { message: 'Response lost.' } }, { status: 503 }) : Response.json(prepared)
    }
    return Response.json(revealed)
  }))
  open()
  await screen.findByText('Response lost.')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('region', { name: 'Saved listening answer' })
  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  expect(screen.queryByRole('radio')).toBeNull()
})

test('after an ambiguous save, a different retry cannot replace the first answer and retains the unsubmitted draft', async () => {
  let puts = 0
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'PUT') {
      puts++
      return puts === 1 ? Response.json({ error: { message: 'Save reply lost.' } }, { status: 503 })
        : Response.json({ error: { code: 'comparison_already_answered', message: 'First answer kept.' } }, { status: 409 })
    }
    return Response.json(puts ? revealed : prepared)
  }))
  open()
  fireEvent.click(await screen.findByRole('radio', { name: 'I am not sure' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save answer and reveal takes' }))
  await screen.findByText('Save reply lost.')
  fireEvent.click(screen.getByRole('radio', { name: 'Version A supports the meaning more clearly' }))
  fireEvent.change(screen.getByRole('textbox', { name: /What did you hear/ }), { target: { value: 'A thought after the lost reply.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save answer and reveal takes' }))
  await screen.findByText('An answer was already saved. The first saved answer is shown below.')
  expect(screen.getByText('Your first answer: I am not sure')).toBeTruthy()
  expect(screen.getByText('Your unsubmitted draft was kept')).toBeTruthy()
  expect(screen.getByText('A thought after the lost reply.')).toBeTruthy()
  expect(puts).toBe(2)
})

test('closing during a pending load releases playback and reopening resumes without losing the local choice', async () => {
  let release!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { release = resolve })
  let posts = 0
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'POST' && ++posts === 1) return pending
    return Response.json(prepared)
  }))
  open()
  const modal = screen.getByRole('dialog')
  fireEvent.click(within(modal).getByRole('button', { name: 'Close comparison' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await act(async () => release(Response.json(prepared)))
  fireEvent.click(screen.getByRole('button', { name: 'Compare with A/B labels' }))
  fireEvent.click(await screen.findByRole('radio', { name: 'I hear no clear difference' }))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Compare with A/B labels' }))
  await waitFor(() => expect((screen.getByRole('radio', { name: 'I hear no clear difference' }) as HTMLInputElement).checked).toBe(true))
})

test('failed private audio can be reloaded without recreating the comparison or choosing an answer', async () => {
  const reload = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  const fetcher = vi.fn(async () => Response.json(prepared)); vi.stubGlobal('fetch', fetcher)
  open()
  const audio = await screen.findByLabelText('Comparison version A')
  fireEvent.error(audio)
  await screen.findByText('Version A could not load. Try loading this saved audio again.')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(reload).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledTimes(2) // one owned create/resume and its authoritative GET
  fireEvent.canPlay(audio)
  expect(screen.queryByText('Version A could not load. Try loading this saved audio again.')).toBeNull()
})
