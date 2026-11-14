import { describe, expect, it } from 'vitest'
import { METRICS } from '../components/MetricTile'
import type { Measurement } from '../api/types'
import { targetLine } from './profile'

const spec = (k: string) => METRICS.find((s) => s.key === k)!
const m = (value: number, unit = ''): Measurement => ({ available: true, value, unit, unavailable_reason: null }) as Measurement
const all = { articulation_rate_wpm: m(167) }

describe('targetLine', () => {
  it('shows the number and distance to the goal target', () => {
    expect(targetLine(spec('speaking_rate_wpm'), m(111.4), { band: 'below', target: { min: 150, max: 190 }, label: 'x', note: '', focus: true }, all)).toBe('111 wpm · your target 150–190')
    expect(targetLine(spec('pause_ratio'), m(0.312), { band: 'above', target: { min: 0.09, max: 0.14 }, label: 'x', note: '', focus: true }, all)).toBe('31 % · your target 9–14 %')
  })
  it('uses the server note when there is no target', () => {
    expect(targetLine(spec('intonation_range_semitones'), m(9), { band: null, target: null, label: 'x', note: 'your starting point', focus: false }, all)).toBe('9 semitones · your starting point')
    expect(targetLine(spec('f0_median_hz'), m(88.2), { band: null, target: null, label: 'x', note: 'for reference, not a score', focus: false }, all)).toBe('88 Hz · for reference, not a score')
  })
  it('falls back to the number and the old note for assessments without interpretation', () => {
    expect(targetLine(spec('speaking_rate_wpm'), m(111), undefined, all)).toBe('111 wpm · 167 without pauses')
  })
})
