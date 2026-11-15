// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useSpeechFollow } from './follow'
import { autoStopSeconds, getMic, useRecorder } from './recorder'

let stopTrack: ReturnType<typeof vi.fn>
let closeContext = vi.fn(() => {})
let stream: MediaStream
let getUserMedia: ReturnType<typeof vi.fn>
let created: FakeRecorder[]
class FakeRecorder {
  static isTypeSupported() { return true }
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { created.push(this) }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['take']) })
    this.onstop?.()
  }
}
class FakeContext {
  close() { closeContext(); return Promise.resolve() }
  createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0.1) } }
  createMediaStreamSource() { return { connect: vi.fn() } }
}
beforeEach(() => {
  created = []; stopTrack = vi.fn(); closeContext = vi.fn()
  stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
  getUserMedia = vi.fn(async () => stream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:take'), revokeObjectURL: vi.fn() })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
const hook = () => renderHook(() => useRecorder({ accepted: ['audio/webm'], maxSeconds: 60 }))

test('unmount during permission request releases the late stream without creating a recorder', async () => {
  let grant!: (s: MediaStream) => void
  getUserMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
  const h = hook()
  let pending!: Promise<void>
  act(() => { pending = h.result.current.start() })
  expect(h.result.current.state).toBe('requesting')
  h.unmount()
  await act(async () => { grant(stream); await pending })
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(created).toHaveLength(0)
})
test('repeated start actions create only one pending request and one recorder', async () => {
  let grant!: (s: MediaStream) => void
  getUserMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
  const h = hook()
  let pending!: Promise<void>
  act(() => { pending = h.result.current.start(); void h.result.current.start() })
  expect(getUserMedia).toHaveBeenCalledOnce()
  await act(async () => { grant(stream); await pending })
  expect(h.result.current.state).toBe('recording')
  expect(created).toHaveLength(1)
  h.unmount()
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(closeContext).toHaveBeenCalledOnce()
})
test('cancel and restart ignores the old permission response', async () => {
  const oldStop = vi.fn()
  const oldStream = { getTracks: () => [{ stop: oldStop }] } as unknown as MediaStream
  let grant!: (s: MediaStream) => void
  getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((resolve) => { grant = resolve }))
  const h = hook()
  let pending!: Promise<void>
  act(() => { pending = h.result.current.start() })
  act(() => h.result.current.reset())
  await act(async () => { await h.result.current.start() })
  await act(async () => { grant(oldStream); await pending })
  expect(oldStop).toHaveBeenCalledOnce()
  expect(stopTrack).not.toHaveBeenCalled()
  expect(created).toHaveLength(1)
  expect(h.result.current.state).toBe('recording')
})
test('recorder constructor failure releases the microphone', async () => {
  vi.stubGlobal('MediaRecorder', class extends FakeRecorder { constructor() { super(); throw Error('constructor failure') } })
  const h = hook()
  await act(async () => { await h.result.current.start() })
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(h.result.current.state).toBe('idle')
  expect(h.result.current.error).toBe('unknown')
})
test('meter initialization failure closes the context and microphone', async () => {
  vi.stubGlobal('AudioContext', class extends FakeContext { createAnalyser(): never { throw Error('meter failure') } })
  const h = hook()
  await act(async () => { await h.result.current.start() })
  expect(closeContext).toHaveBeenCalledOnce()
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(h.result.current.error).toBe('unknown')
})
test('automatic stop keeps a take and leaves headroom before the hard cap', async () => {
  vi.useFakeTimers()
  const h = hook()
  await act(async () => { await h.result.current.start() })
  await act(async () => { await vi.advanceTimersByTimeAsync(autoStopSeconds(60) * 1000) })
  expect(h.result.current.state).toBe('recorded')
  expect(h.result.current.blob?.size).toBeGreaterThan(0)
  expect(h.result.current.seconds).toBeLessThan(60)
  expect(h.result.current.limitReached).toBe(true)
  expect(stopTrack).toHaveBeenCalledOnce()
  act(() => h.result.current.reset())
  expect(h.result.current.url).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:take')
})
test('cancelling getMic does not wait for the permission timeout', async () => {
  getUserMedia.mockImplementation(() => new Promise(() => {}))
  const controller = new AbortController()
  const pending = getMic(10000, controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})


test('optional speech highlighting releases audio if socket initialization fails', async () => {
  vi.stubGlobal('WebSocket', class { constructor() { throw Error('socket unavailable') } })
  const h = renderHook(() => useSpeechFollow('Read at your own pace.', true))
  await act(async () => { await Promise.resolve() })
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(closeContext).toHaveBeenCalledOnce()
  expect(h.result.current.supported).toBe(false)
})

test('recorder errors stop audio capture and allow another start', async () => {
  const h = hook()
  await act(async () => { await h.result.current.start() })
  act(() => created[0].onerror?.())
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(closeContext).toHaveBeenCalledOnce()
  expect(h.result.current.error).toBe('unknown')
  await act(async () => { await h.result.current.start() })
  expect(created).toHaveLength(2)
  expect(h.result.current.state).toBe('recording')
})
