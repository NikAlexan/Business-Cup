import type { Comparison, Measurement, MetricInterpretation } from '../api/types'
import { targetLine } from '../lib/profile'

const humanize = (s: string | null) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Not available')

export type MetricSpec = { key: string; label: string; unit: string; scale?: number; note?: (m: Record<string, Measurement>) => string | null }

export const METRICS: MetricSpec[] = [
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
  { key: 'intonation_range_semitones', label: 'Intonation', unit: 'semitones', note: () => 'Pitch range in semitones' },
  {
    key: 'f0_median_hz',
    label: 'Pitch',
    unit: 'Hz',
    note: (m) => {
      const r = m.f0_range_hz
      if (!r?.available || !r.value || typeof r.value !== 'object') return null
      return `Range ${Math.round(r.value.p10)}–${Math.round(r.value.p90)} Hz`
    },
  },
]

export function MetricTile({
  spec,
  all,
  comparison,
  interpretation,
}: {
  spec: MetricSpec
  all: Record<string, Measurement>
  comparison?: Comparison | null
  interpretation?: MetricInterpretation
}) {
  const m = all[spec.key]
  const head = (focus: boolean) => (
    <span className="rs-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      {spec.label}
      {focus && (
        <span className="rs-badge" style={{ height: 24, fontSize: 12, background: 'var(--sun)', color: 'var(--sun-ink)' }}>
          Working on this
        </span>
      )}
    </span>
  )
  if (!m?.available || typeof m.value !== 'number') {
    return (
      <div className="rs-metric">
        {head(false)}
        <span className="rs-metric__v" style={{ fontSize: 20, lineHeight: '31px', color: 'var(--muted)' }}>
          Not measured
        </span>
        <span className="rs-metric__n">{humanize(m?.unavailable_reason ?? null)}</span>
      </div>
    )
  }
  const scale = spec.scale ?? 1
  const c = comparison?.metrics[spec.key]
  const i = interpretation
  // Historical profiles may still store a label that inferred placement from time share.
  const pauseLabel = i?.band ? ({ below: 'Lower pause share', within: 'Pause share in practice range', above: 'Higher pause share' }[i.band]) : undefined
  return (
    <div className="rs-metric" style={i?.focus ? { borderColor: 'var(--sun-edge)' } : undefined}>
      {head(!!i?.focus)}
      {i ? (
        <span className="rs-metric__v" style={{ fontSize: 22, whiteSpace: 'normal' }}>{spec.key === 'pause_ratio' ? pauseLabel ?? i.label : i.label}</span>
      ) : (
        <span className="rs-metric__v">
          {Math.round(m.value * scale)}
          <small>{spec.unit}</small>
        </span>
      )}
      {i && <span className="rs-metric__n">{targetLine(spec, m, i, all)}</span>}
      {/* Profile only: the caveat belongs next to the interpretation, not on every daily tile. */}
      {spec.key === 'pause_ratio' && i && <span className="rs-metric__n">Time in pauses does not measure where they fall. Listen back to judge the phrasing.</span>}
      <span className="rs-metric__n">
        {c
          ? c.available && c.delta !== null
            ? `Was ${Math.round((c.before as number) * scale)} ${spec.unit} · ${c.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(c.delta * scale * 10) / 10)}`
            : 'Not comparable to baseline'
          : i
            ? null
            : spec.note?.(all)}
      </span>
    </div>
  )
}
