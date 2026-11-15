import { useRef, useState, type AudioHTMLAttributes, type ReactNode, type Ref } from 'react'
import { clock } from '../lib/format'

type Props = Omit<AudioHTMLAttributes<HTMLAudioElement>, 'controls' | 'style'> & {
  ref?: Ref<HTMLAudioElement>
  title?: ReactNode // visible name next to the button; aria-label still names the <audio> itself
}

const PlayIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
const SPEEDS = [1, 1.25, 1.5, 0.75]
const DownloadIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
const PauseIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>

// Native <audio> stays in the DOM (refs, events, seeking from code keep working); only its look is ours.
export function AudioPlayer({ ref, title, onPlay, onPause, onEnded, onTimeUpdate, onLoadedMetadata, onDurationChange, ...audio }: Props) {
  const el = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [d, setD] = useState(0)
  const [rate, setRate] = useState(1)
  const name = audio['aria-label'] ?? 'recording'
  const setRef = (node: HTMLAudioElement | null) => {
    el.current = node
    if (typeof ref === 'function') return ref(node)
    if (ref) ref.current = node
  }
  const probing = useRef(false)
  const dur = (a: HTMLAudioElement) => {
    if (Number.isFinite(a.duration)) { setD(a.duration); if (probing.current) { probing.current = false; a.currentTime = 0; setT(0) } return }
    // Recorder webm has no duration header: jumping far ahead makes the browser compute it, then we return to 0.
    if (a.duration === Infinity && !probing.current) { probing.current = true; a.currentTime = 1e101 }
  }
  const pct = d ? Math.min(100, (t / d) * 100) : 0
  return (
    <div className="rs-player">
      <button className="rs-player__btn" type="button" aria-label={(playing ? 'Pause ' : 'Play ') + name}
        onClick={() => { const a = el.current; if (!a) return; if (a.paused) a.play().catch(() => {}); else a.pause() }}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="rs-stack" style={{ flex: 1, gap: 6, minWidth: 0 }}>
        {title && <span className="rs-player__title">{title}</span>}
        <input className="rs-player__track" type="range" min={0} max={d || 0} step={0.1} value={Math.min(t, d)} disabled={!d}
          aria-label={'Seek ' + name} style={{ '--p': pct + '%' } as React.CSSProperties}
          onChange={(e) => { const a = el.current; if (a) { a.currentTime = +e.target.value; setT(+e.target.value) } }} />
      </div>
      <span className="rs-player__time">{clock(t)} / {d ? clock(d) : '–:––'}</span>
      {/* Kept from the native controls: speed and download. */}
      <button className="rs-player__mini" type="button" aria-label={'Playback speed ' + rate + '×, change'}
        onClick={() => { const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length]; setRate(next); if (el.current) el.current.playbackRate = next }}>{rate}×</button>
      {audio.src && <a className="rs-player__mini" href={audio.src} download aria-label={'Download ' + name}><DownloadIcon /></a>}
      <audio ref={setRef} {...audio}
        onPlay={(e) => { setPlaying(true); onPlay?.(e) }}
        onPause={(e) => { setPlaying(false); onPause?.(e) }}
        onEnded={(e) => { setPlaying(false); onEnded?.(e) }}
        onTimeUpdate={(e) => { if (probing.current) return dur(e.currentTarget); setT(e.currentTarget.currentTime); onTimeUpdate?.(e) }}
        onLoadedMetadata={(e) => { dur(e.currentTarget); e.currentTarget.playbackRate = rate; onLoadedMetadata?.(e) }}
        onDurationChange={(e) => { dur(e.currentTarget); onDurationChange?.(e) }} />
    </div>
  )
}
