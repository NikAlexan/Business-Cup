import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../api/api'
import type { Recording } from '../api/types'

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
const base = (t: string) => t.split(';')[0].trim()

export function pickMimeType(accepted: string[], isSupported: (t: string) => boolean): string | null {
  return CANDIDATES.find((t) => accepted.includes(base(t)) && isSupported(t)) ?? null
}

export const extensionFor = (mime: string): 'webm' | 'm4a' => (base(mime) === 'audio/mp4' ? 'm4a' : 'webm')

export type MicErrorKind = 'denied' | 'not_found' | 'insecure' | 'timeout' | 'unsupported' | 'unknown'

export function micErrorKind(e: unknown, secure: boolean): MicErrorKind {
  if (!secure) return 'insecure'
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'not_found'
  if (name === 'TimeoutError') return 'timeout'
  return 'unknown'
}

export const limitFor = (purpose: 'assessment' | 'exercise') => (purpose === 'assessment' ? 60 : 90)

export async function getMic(timeoutMs = 10_000): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new DOMException('insecure', 'SecurityError')
  let timer: number | undefined
  let expired = false
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      expired = true
      reject(new DOMException('timeout', 'TimeoutError'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then((stream) => {
        // A permission prompt may resolve after timeout. Release that late microphone immediately.
        if (expired) stream.getTracks().forEach((track) => track.stop())
        return stream
      }),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

export type LevelStatus = 'waiting' | 'good' | 'loud'
export type Level = { level: number; status: LevelStatus }

// Classifies mic input over time, not per frame: pauses between words are normal,
// the noise floor differs per room/mic, and opening the mic often clicks.
export function createLevelJudge() {
  let floor = 0.02
  let voiceAt = -Infinity
  let clips: number[] = []
  let start = -1
  return (rms: number, peak: number, now: number): LevelStatus => {
    if (start < 0) start = now
    if (now - start < 700) return 'waiting'
    floor = rms < floor ? floor * 0.9 + rms * 0.1 : floor * 0.999 + rms * 0.001
    if (rms > Math.max(0.012, floor * 2.5)) voiceAt = now
    if (peak >= 0.99) clips.push(now)
    clips = clips.filter((t) => now - t < 1500)
    if (clips.length >= 3) return 'loud'
    return now - voiceAt < 2000 ? 'good' : 'waiting'
  }
}

// AnalyserNode RMS for the bars plus a judged status, ~15 updates/s. Returns a stop function.
export function meter(stream: MediaStream, onLevel: (v: Level) => void): () => void {
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  const judge = createLevelJudge()
  let raf = 0
  let smooth = 0
  let last = 0
  const tick = (now = 0) => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    let peak = 0
    for (const v of buf) {
      sum += v * v
      peak = Math.max(peak, Math.abs(v))
    }
    const rms = Math.sqrt(sum / buf.length)
    const status = judge(rms, peak, now)
    const display = Math.min(1, rms * 5)
    smooth = display > smooth ? display : smooth * 0.9 + display * 0.1 // fast attack, slow release
    if (now - last > 66) {
      last = now
      onLevel({ level: smooth, status })
    }
    raf = requestAnimationFrame(tick)
  }
  tick()
  return () => {
    cancelAnimationFrame(raf)
    void ctx.close()
  }
}

type State = 'idle' | 'recording' | 'recorded'

export function useRecorder({ maxSeconds, accepted }: { maxSeconds: number; accepted: string[] }) {
  const [state, setState] = useState<State>('idle')
  const [level, setLevel] = useState<Level>({ level: 0, status: 'waiting' })
  const [seconds, setSeconds] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [mime, setMime] = useState<string | null>(null)
  const [error, setError] = useState<MicErrorKind | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const cleanup = useRef<() => void>(() => {})

  const stop = useCallback(() => {
    if (rec.current?.state === 'recording') rec.current.stop()
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const type = pickMimeType(accepted, (t) => MediaRecorder.isTypeSupported(t))
      if (!type) {
        setError('unsupported')
        return
      }
      const stream = await getMic()
      const r = new MediaRecorder(stream, { mimeType: type })
      const chunks: Blob[] = []
      const stopMeter = meter(stream, setLevel)
      const began = Date.now()
      const timer = window.setInterval(() => {
        const s = (Date.now() - began) / 1000
        setSeconds(s)
        if (s >= maxSeconds) stop() // auto-stop keeps the take, it is not discarded
      }, 200)
      cleanup.current = () => {
        clearInterval(timer)
        stopMeter()
        stream.getTracks().forEach((t) => t.stop())
      }
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      r.onstop = () => {
        cleanup.current()
        const actual = r.mimeType || type
        const b = new Blob(chunks, { type: actual })
        setSeconds((Date.now() - began) / 1000)
        setBlob(b)
        setMime(actual)
        setUrl(URL.createObjectURL(b))
        setLevel({ level: 0, status: 'waiting' })
        setState('recorded')
      }
      rec.current = r
      r.start(250)
      setSeconds(0)
      setState('recording')
    } catch (e) {
      setError(micErrorKind(e, window.isSecureContext))
    }
  }, [accepted, maxSeconds, stop])

  const reset = useCallback(() => {
    setUrl((u) => {
      if (u) URL.revokeObjectURL(u)
      return null
    })
    setBlob(null)
    setSeconds(0)
    setState('idle')
  }, [])

  useEffect(
    () => () => {
      if (rec.current?.state === 'recording') {
        rec.current.onstop = null
        rec.current.stop()
      }
      cleanup.current()
    },
    [],
  )
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  return { state, level, seconds, blob, url, mime, error, start, stop, reset }
}

export function uploadRecording(fields: Record<string, string>, blob: Blob, mime: string, key: string) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  form.append('file', new File([blob], 'recording.' + extensionFor(mime), { type: base(mime) }))
  return request<{ recording: Recording; job_id: string; poll_after_ms: number }>('/recordings', {
    form,
    idempotencyKey: key,
  })
}
