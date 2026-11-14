import { LevelMeter, STATUS_TEXT } from './LevelMeter'
import { MicBlocked } from './MicBlocked'
import type { useRecorder } from '../lib/recorder'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const MicIcon = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)
const StopIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" />
  </svg>
)

// Record → stop (or auto-stop at the limit) → listen → send or record again.
export function RecorderDock({ r, max, sending, onSend, sendLabel = 'Use this take' }: { r: ReturnType<typeof useRecorder>; max: number; sending: boolean; onSend: () => void; sendLabel?: string }) {
  const status = r.level.status
  if (r.error) return <MicBlocked kind={r.error} onRetry={r.start} />
  if (r.state === 'recorded' && r.url)
    return (
      <div className="rs-dock" style={{ flexDirection: 'column', gap: 14 }}>
        <span className="rs-label">
          Your take · {clock(r.seconds)}
          {r.seconds >= max - 0.5 ? ' · stopped at the time limit' : ''}
        </span>
        <audio controls src={r.url} style={{ width: '100%', maxWidth: 420 }} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="rs-btn" type="button" onClick={onSend} disabled={sending}>
            {sending ? 'Checking…' : sendLabel}
          </button>
          <button className="rs-btn rs-btn--secondary" type="button" onClick={r.reset} disabled={sending}>
            Record again
          </button>
        </div>
      </div>
    )
  const on = r.state === 'recording'
  return (
    <div className="rs-dock">
      <div className="rs-stack" style={{ alignItems: 'center', gap: 4 }}>
        <span style={{ font: '600 28px var(--font-display)' }}>
          {clock(r.seconds)} <span style={{ color: 'var(--muted)', fontSize: 18 }}>/ {clock(max)}</span>
        </span>
        <span className="rs-label" style={on ? { color: 'var(--success)' } : undefined} aria-live="polite">
          {on ? (status === 'waiting' ? 'Recording · start reading' : 'Recording · ' + STATUS_TEXT[status].toLowerCase()) : 'Press to record'}
        </span>
      </div>
      <button className="rs-rec" type="button" aria-label={on ? 'Stop recording' : 'Start recording'} onClick={on ? r.stop : r.start} style={{ marginBottom: 5, cursor: 'pointer' }}>
        {on ? <StopIcon /> : <MicIcon />}
      </button>
      <LevelMeter level={r.level.level} label={'Input level: ' + STATUS_TEXT[status]} />
    </div>
  )
}
