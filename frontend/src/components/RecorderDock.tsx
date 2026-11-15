import { AudioPlayer } from './AudioPlayer'
import { useEffect, useRef } from 'react'
import { LevelMeter, STATUS_TEXT } from './LevelMeter'
import { MicBlocked } from './MicBlocked'
import type { useRecorder } from '../lib/recorder'

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

// People finish at their own pace; automatic safety stops are explained after the take.
// Record → stop → listen → send or record again.
export function RecorderDock({
  r,
  sending,
  onSend,
  sendLabel = 'Use this take',
  onPlayTime,
  startDisabled = false,
}: {
  r: ReturnType<typeof useRecorder>
  sending: boolean
  startDisabled?: boolean
  onSend: () => void
  sendLabel?: string
  onPlayTime?: (seconds: number) => void // playback position for word highlighting
}) {
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const status = r.level.status
  if (r.error) return <MicBlocked kind={r.error} onRetry={r.start} />
  if (r.state === 'recorded' && r.url)
    return (
      <div className="rs-dock" style={{ flexDirection: 'column', gap: 14 }}>
        <span className="rs-label" role="status">{r.limitReached ? 'Recording reached its length limit. Listen for a complete ending before sending.' : 'Your take — listen back if you like'}</span>
        <div style={{ width: '100%', maxWidth: 420 }}><AudioPlayer
          aria-label="Your take"
          src={r.url}
          // timeupdate fires only ~4×/s; follow every frame while playing
          onPlay={(e) => {
            const a = e.currentTarget
            const tick = () => {
              onPlayTime?.(a.currentTime)
              raf.current = requestAnimationFrame(tick)
            }
            tick()
          }}
          onPause={() => cancelAnimationFrame(raf.current)}
          onSeeked={(e) => onPlayTime?.(e.currentTarget.currentTime)}
          onEnded={() => {
            cancelAnimationFrame(raf.current)
            onPlayTime?.(Infinity) // end of the take: everything heard, even words timed past the last frame
          }}
        /></div>
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
  const requesting = r.state === 'requesting'
  return (
    <div className="rs-dock">
      <div className="rs-stack" style={{ alignItems: 'center', gap: 4 }}>
        <span className="rs-label" style={on ? { color: 'var(--success)' } : undefined} aria-live="polite">
          {on ? (status === 'waiting' ? 'Recording · read at your own pace' : 'Recording · ' + STATUS_TEXT[status].toLowerCase() + ' · press stop when done') : requesting ? 'Waiting for microphone permission…' : 'Press to record'}
        </span>
      </div>
      <button className="rs-rec" type="button" disabled={requesting || (!on && (sending || startDisabled))} aria-label={on ? 'Stop recording' : requesting ? 'Waiting for microphone permission' : 'Start recording'} onClick={on ? r.stop : r.start} style={{ marginBottom: 5, cursor: 'pointer' }}>
        {on ? <StopIcon /> : <MicIcon />}
      </button>
      {requesting && <button className="rs-btn rs-btn--secondary" type="button" onClick={r.reset}>Cancel microphone request</button>}
      <LevelMeter level={r.level.level} label={'Input level: ' + STATUS_TEXT[status]} />
    </div>
  )
}
