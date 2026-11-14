import { useEffect, useRef, useState } from 'react'

const SHAPE = [0.35, 0.6, 0.9, 0.55, 1, 0.7, 0.45, 0.8, 0.6, 0.95, 0.4, 0.7, 0.5, 0.85]

export function LevelMeter({ level, label }: { level: number; label: string }) {
  return (
    <div className="rs-wave" role="img" aria-label={label}>
      {SHAPE.map((s, i) => (
        <i key={i} style={{ height: `${Math.max(8, Math.round(s * Math.min(1, level * 1.6) * 100))}%`, transition: 'height 120ms ease-out' }} />
      ))}
    </div>
  )
}

export type LevelStatus = 'waiting' | 'good' | 'loud'
export const STATUS_TEXT: Record<LevelStatus, string> = { waiting: 'Say a few words…', good: 'Good level', loud: 'Too loud — move back a little' }

// Silence between words is normal, so judge the last ~2 s, not the current frame.
export function useLevelStatus(level: number): LevelStatus {
  const voiceAt = useRef(0)
  const loudAt = useRef(0)
  const [, tick] = useState(0)
  const now = performance.now()
  if (level > 0.06) voiceAt.current = now
  if (level > 0.95) loudAt.current = now
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 500)
    return () => clearInterval(t)
  }, [])
  if (now - loudAt.current < 1500) return 'loud'
  return now - voiceAt.current < 2000 ? 'good' : 'waiting'
}
