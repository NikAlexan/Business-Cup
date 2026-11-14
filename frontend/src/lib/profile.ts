import type { Measurement, MetricInterpretation } from '../api/types'
import type { MetricSpec } from '../components/MetricTile'

const r = (spec: MetricSpec, v: number) => Math.round(v * (spec.scale ?? 1))

export function targetLine(spec: MetricSpec, m: Measurement, i: MetricInterpretation | undefined, all: Record<string, Measurement>): string {
  const tail = !i
    ? spec.note?.(all)
    : i.target
      ? `your target ${r(spec, i.target.min)}–${r(spec, i.target.max)}${spec.unit === '%' ? ' %' : ''}`
      : i.note
  const n = `${r(spec, m.value as number)} ${spec.unit}`
  return tail ? `${n} · ${tail}` : n
}
