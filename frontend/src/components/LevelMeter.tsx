const SHAPE = [0.35, 0.6, 0.9, 0.55, 1, 0.7, 0.45, 0.8, 0.6, 0.95, 0.4, 0.7, 0.5, 0.85]

export function LevelMeter({ level, label }: { level: number; label: string }) {
  return (
    <div className="rs-wave" role="img" aria-label={label}>
      {SHAPE.map((s, i) => (
        <i key={i} style={{ height: `${Math.max(8, Math.round(s * Math.min(1, level * 1.6) * 100))}%`, transition: 'height 80ms linear' }} />
      ))}
    </div>
  )
}

export const levelLabel = (level: number) => (level < 0.03 ? 'Too quiet' : level > 0.9 ? 'Too loud' : 'Good level')
