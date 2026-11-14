import type { LevelStatus } from '../lib/recorder'

const SHAPE = [0.35, 0.6, 0.9, 0.55, 1, 0.7, 0.45, 0.8, 0.6, 0.95, 0.4, 0.7, 0.5, 0.85]

export const STATUS_TEXT: Record<LevelStatus, string> = { waiting: 'Say a few words…', good: 'Good level', loud: 'Too loud — move back a little' }

export function LevelMeter({ level, label }: { level: number; label: string }) {
  return (
    <div className="rs-wave" role="img" aria-label={label}>
      {SHAPE.map((s, i) => (
        <i key={i} style={{ height: `${Math.max(8, Math.round(s * level * 100))}%`, transition: 'height 120ms ease-out' }} />
      ))}
    </div>
  )
}
