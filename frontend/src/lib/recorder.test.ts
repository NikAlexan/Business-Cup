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
