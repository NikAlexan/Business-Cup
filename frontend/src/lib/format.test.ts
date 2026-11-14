import { expect, test } from 'vitest'
import { formatDate, formatMinutes } from './format'

test('minutes', () => {
  expect(formatMinutes(0)).toBe('0 min')
  expect(formatMinutes(125)).toBe('2 min')
})
test('date', () => {
  expect(formatDate('2026-11-28', 'America/New_York')).toBe('Nov 28')
  expect(formatDate('2026-11-14T03:00:00Z', 'America/New_York')).toBe('Nov 13')
})
