import { expect, test } from 'vitest'
import { followWords, tokenize } from './follow'

const script = tokenize('A calm voice carries a clear message. Take a moment, to let each idea settle.')

test('tokenize strips punctuation and case', () => {
  expect(script.slice(0, 3)).toEqual(['a', 'calm', 'voice'])
  expect(script).toContain('moment')
})
test('follows heard words in order', () => {
  expect(followWords(script, tokenize('a calm voice'))).toBe(3)
  expect(followWords(script, [])).toBe(0)
})
test('tolerates a misheard or skipped word', () => {
  expect(followWords(script, tokenize('a calm boys carries a'))).toBe(5)
  expect(followWords(script, tokenize('a calm carries a clear'))).toBe(6)
})
test('does not jump ahead on a stray common word', () => {
  expect(followWords(script, tokenize('a calm voice settle'))).toBe(3)
})
