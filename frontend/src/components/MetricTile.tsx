import type { Comparison, Measurement } from '../api/types'

const humanize = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Not available')

export type MetricSpec = { key: string; label: string; unit: string; scale?: number; note?: (m: Record<string, Measurement>) => string | null }

export const METRICS: MetricSpec[] = [
  {
    key: 'f0_median_hz',
    label: 'Median pitch',
    unit: 'Hz',
    note: (m) => {
      const r = m.f0_range_hz
      if (!r?.available || !r.value || typeof r.value !== 'object') return null
      return `Range ${Math.round(r.value.p10)}–${Math.round(r.value.p90)} Hz`
    },
  },
  {
    key: 'speaking_rate_wpm',
    label: 'Pace',
    unit: 'wpm',
    note: (m) => (m.articulation_rate_wpm?.available ? `${Math.round(m.articulation_rate_wpm.value as number)} without pauses` : null),
  },
  {
    key: 'pause_ratio',
    label: 'Pauses',
    unit: '%',
    scale: 100,
    note: (m) => (m.pause_count?.available ? `${m.pause_count.value} pauses` : null),
  },
  { key: 'intonation_range_semitones', label: 'Intonation', unit: 'st', note: () => 'Pitch range in semitones' },
]

export function MetricTile({ spec, all, comparison }: { spec: MetricSpec; all: Record<string, Measurement>; comparison?: Comparison | null }) {
  const m = all[spec.key]
  if (!m?.available || typeof m.value !== 'number') {
    return (
      <div className="rs-metric">
        <span className="rs-label">{spec.label}</span>
        <span className="rs-metric__v" style={{ fontSize: 20, lineHeight: '31px', color: 'var(--muted)' }}>
          Not measured
        </span>
        <span className="rs-metric__n">{humanize(m?.unavailable_reason ?? null)}</span>
      </div>
    )
  }
  const scale = spec.scale ?? 1
  const c = comparison?.metrics[spec.key]
  return (
    <div className="rs-metric">
      <span className="rs-label">{spec.label}</span>
      <span className="rs-metric__v">
        {Math.round(m.value * scale)}
        <small>{spec.unit}</small>
      </span>
      <span className="rs-metric__n">
        {c
          ? c.available && c.delta !== null
            ? `Was ${Math.round((c.before as number) * scale)} ${spec.unit} · ${c.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(c.delta * scale * 10) / 10)}`
            : 'Not comparable to baseline'
          : spec.note?.(all)}
      </span>
    </div>
  )
}
