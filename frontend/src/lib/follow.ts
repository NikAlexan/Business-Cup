import { useCallback, useEffect, useRef, useState } from 'react'
import { getMic } from './recorder'

export const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const LOOKAHEAD = 3

// A heard word matches a script word exactly, or as its 3+ letter beginning: streaming
// recognition shows "quarter" before "quarterly".
const same = (word: string, heard: string) => word === heard || (heard.length >= 3 && word.startsWith(heard))

// How many script words have been read: each heard word may match within a short window ahead,
// so a misheard or skipped word doesn't stall the cursor and a stray word doesn't jump it.
// The recognizer also splits words ("to day", "quart early"), so two heard words may form one.
// If the window misses (the start wasn't heard), two heard words in a row re-anchor further on.
export function followWords(script: string[], heard: string[]): number {
  let pos = 0
  for (let k = 0; k < heard.length; k++) {
    const h = heard[k]
    const next = heard[k + 1]
    let found = false
    for (let j = pos; j < Math.min(script.length, pos + LOOKAHEAD + 1); j++) {
      if (next !== undefined && script[j] === h + next) {
        pos = j + 1
        k++
        found = true
        break
      }
      if (same(script[j], h)) {
        pos = j + 1
        found = true
        break
      }
    }
    if (found || next === undefined) continue
    for (let j = pos + LOOKAHEAD + 1; j + 1 < script.length; j++) {
      if (script[j] === h && same(script[j + 1], next)) {
        pos = j + 2
        k++
        break
      }
    }
  }
  return pos
}

// Batches ~100 ms of mono input per message instead of one per 128-sample render quantum.
const TAP = `registerProcessor('tap', class extends AudioWorkletProcessor {
  buf = new Float32Array(sampleRate / 10); n = 0
  process([input]) {
    const ch = input[0]
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(this.buf.length); this.n = 0 }
    }
    return true
  }
})`

export type HeardWord = [word: string, start: number] // start: seconds from the take's start

// Script words read by time `t` of the take, for highlighting during playback.
export const readAt = (script: string[], words: HeardWord[], t: number) =>
  followWords(
    script,
    words.filter(([, start]) => start <= t).flatMap(([w]) => tokenize(w)),
  )

// Streams the take to the server's recognizer and follows the script by the words it hears.
// Words keep their timing, so `readAt(seconds)` replays the highlight while the take plays back.
// Any failure (no model, socket closed, mic busy) just leaves the text unhighlighted.
export function useSpeechFollow(text: string, active: boolean) {
  const [read, setRead] = useState(0)
  const [supported, setSupported] = useState(false) // the server accepted the stream at least once
  const heard = useRef<HeardWord[]>([])
  const take = useRef(0) // a late reply from the previous take must not overwrite the new one
  useEffect(() => {
    if (!active) return
    const script = tokenize(text)
    const began = performance.now() // ≈ the recorder's start: this runs as its state turns 'recording'
    let offset = 0 // seconds between the take's start and the first sample sent to the server
    let stop = () => {}
    let cancelled = false
    const controller = new AbortController()
    setRead(0)
    setSupported(false)
    heard.current = []
    const id = ++take.current
    void (async () => {
      // Own mic stream: the recorder keeps its stream; browsers share one permission.
      const stream = await getMic(10_000, controller.signal)
      stop = () => stream.getTracks().forEach((track) => track.stop())
      if (cancelled) return stop()
      // Native rate: Firefox can't resample a mic source; the server resamples.
      // ponytail: 48 kHz float32 is ~190 KB/s up; downsample in the worklet if mobile data matters.
      const ctx = new AudioContext()
      let audioClosed = false
      stop = () => {
        if (audioClosed) return
        audioClosed = true
        void ctx.close()
        stream.getTracks().forEach((t) => t.stop())
      }
      if (cancelled) return stop()
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/speech-follow?rate=${ctx.sampleRate}`)
      ws.binaryType = 'arraybuffer'
      const pending: ArrayBuffer[] = [] // audio captured before the socket opened
      ws.onopen = () => {
        if (cancelled) { ws.close(); return }
        setSupported(true)
        pending.splice(0).forEach((b) => ws.send(b))
      }
      ws.onmessage = (e) => {
        if (id !== take.current) return
        heard.current = (JSON.parse(e.data).words as HeardWord[]).map(([w, t]) => [w, t + offset])
        if (!cancelled) setRead(followWords(script, heard.current.flatMap(([w]) => tokenize(w))))
      }
      const closeAudio = stop
      ws.onclose = () => { closeAudio(); if (!cancelled) setSupported(false) }
      ws.onerror = () => { closeAudio(); ws.close(); if (!cancelled) setSupported(false) }
      stop = () => {
        closeAudio()
        if (ws.readyState !== WebSocket.OPEN) return ws.close()
        // The recognizer lags ~0.5 s: flush the last words with silence, then close on the reply.
        ws.addEventListener('message', () => ws.close())
        setTimeout(() => ws.close(), 2000)
        ws.send(new Float32Array(Math.round(ctx.sampleRate * 0.6)).buffer)
      }
      const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      if (cancelled) return
      const tap = new AudioWorkletNode(ctx, 'tap')
      tap.port.onmessage = (e) => (ws.readyState === WebSocket.OPEN ? ws.send(e.data) : pending.push(e.data))
      ctx.createMediaStreamSource(stream).connect(tap)
      offset = (performance.now() - began) / 1000
    })().catch(() => stop()) // optional highlighting must release resources on setup failure
    return () => {
      cancelled = true
      controller.abort()
      stop()
    }
  }, [active, text])
  const at = useCallback((t: number) => readAt(tokenize(text), heard.current, t), [text])
  return { read, supported, readAt: at }
}
