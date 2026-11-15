import { expect, test } from 'vitest'
import { formatDate, formatEstimate, formatMinutes } from './format'

test('minutes', () => {
  expect(formatMinutes(0)).toBe('0 min')
  expect(formatMinutes(125)).toBe('2 min')
})
test('date', () => {
  expect(formatDate('2026-11-28', 'America/New_York')).toBe('Nov 28')
  expect(formatDate('2026-11-14T03:00:00Z', 'America/New_York')).toBe('Nov 13')
})


test('estimates preserve short drills and distinguish half-minute sessions', () => {
  expect(formatEstimate(35)).toBe('35 sec')
  expect(formatEstimate(90)).toBe('1.5 min')
  expect(formatEstimate(324)).toBe('5.5 min')
})
