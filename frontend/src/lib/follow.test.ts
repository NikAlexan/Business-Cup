import { expect, test } from 'vitest'
import { followWords, readAt, tokenize } from './follow'

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
test('accepts a partial or split word from streaming recognition', () => {
  const s = tokenize('our quarterly results')
  expect(followWords(s, tokenize('our quarter'))).toBe(2)
  expect(followWords(s, tokenize('our quart early results'))).toBe(3)
  expect(followWords(tokenize('today i will'), tokenize('to day i will'))).toBe(3)
  expect(followWords(s, tokenize('our qu'))).toBe(1)
})
test('re-anchors on two heard words in a row when the start was missed', () => {
  const s = tokenize('Today I will speak at a comfortable pace, making each word clear. A steady voice helps.')
  expect(followWords(s, tokenize('comfortable pays makingly toward clear a steady voice'))).toBe(s.indexOf('voice') + 1)
  expect(followWords(s, tokenize('comfortable'))).toBe(0)
})
test('replays the highlight by playback time', () => {
  const s = tokenize('Today I will speak')
  const words: [string, number][] = [['TO', 0.4], ['DAY', 0.6], ['I', 0.8], ['WILL', 1.0], ['SPEAK', 1.2]]
  expect(readAt(s, words, 0.1)).toBe(0)
  expect(readAt(s, words, 0.9)).toBe(2)
  expect(readAt(s, words, 5)).toBe(4)
})
