import { afterEach, expect, test, vi } from 'vitest'
import { ApiError, nextKey, queryRetry, request } from './api'

const reply = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
afterEach(() => vi.unstubAllGlobals())

test('request surfaces backend code and message', async () => {
  reply(409, { error: { code: 'lesson_locked', message: 'This lesson is not available yet.', details: {} } })
  await expect(request('/x')).rejects.toMatchObject({ status: 409, code: 'lesson_locked', message: 'This lesson is not available yet.' })
})
test('401 is unauthorized', async () => {
  reply(401, { error: { code: 'session_required', message: 'no' } })
  await expect(request('/me')).rejects.toMatchObject({ code: 'unauthorized' })
})
test('retry only network and 5xx', () => {
  expect(queryRetry(0, new ApiError(409, 'c', 'm'))).toBe(false)
  expect(queryRetry(0, new ApiError(503, 'c', 'm'))).toBe(true)
  expect(queryRetry(0, new TypeError('net'))).toBe(true)
  expect(queryRetry(2, new TypeError('net'))).toBe(false)
})
test('key reused for same body, new for different', () => {
  const a = nextKey(null, { x: 1 })
  expect(nextKey(a, { x: 1 }).key).toBe(a.key)
  expect(nextKey(a, { x: 2 }).key).not.toBe(a.key)
})
