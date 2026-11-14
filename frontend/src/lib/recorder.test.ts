import { expect, test } from 'vitest'
import { jobPollInterval } from '../api/hooks'
import type { Job } from '../api/types'
import { extensionFor, limitFor, micErrorKind, pickMimeType } from './recorder'

test('pickMimeType', () => {
  expect(pickMimeType(['audio/webm', 'audio/mp4'], (t) => t !== 'audio/webm;codecs=opus' && t !== 'audio/webm')).toBe('audio/mp4')
  expect(pickMimeType(['audio/webm'], () => true)).toBe('audio/webm;codecs=opus')
  expect(pickMimeType(['audio/wav'], () => true)).toBe(null)
  expect(extensionFor('audio/mp4')).toBe('m4a')
  expect(extensionFor('audio/webm;codecs=opus')).toBe('webm')
})
test('micErrorKind', () => {
  expect(micErrorKind(new DOMException('', 'NotAllowedError'), true)).toBe('denied')
  expect(micErrorKind(new DOMException('', 'NotFoundError'), true)).toBe('not_found')
  expect(micErrorKind(new Error('x'), false)).toBe('insecure')
})
test('poll and limits', () => {
  expect(jobPollInterval({ status: 'processing', poll_after_ms: 2000 } as Job)).toBe(2000)
  expect(jobPollInterval({ status: 'failed' } as Job)).toBe(false)
  expect(limitFor('exercise')).toBe(90)
  expect(limitFor('assessment')).toBe(60)
})

test('level judge ignores the opening click and pauses between words', async () => {
  const { createLevelJudge } = await import('./recorder')
  const j = createLevelJudge()
  expect(j(0.5, 1, 0)).toBe('waiting') // click on open
  expect(j(0.01, 0.02, 800)).toBe('waiting') // quiet room
  expect(j(0.12, 0.3, 1000)).toBe('good') // speech
  expect(j(0.01, 0.02, 2500)).toBe('good') // pause between words
  expect(j(0.01, 0.02, 3200)).toBe('waiting') // silence for > 2 s
  for (const t of [3300, 3400, 3500]) j(0.4, 1, t)
  expect(j(0.4, 1, 3600)).toBe('loud') // sustained clipping
})
