import { useEffect, useState } from 'react'

export const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const LOOKAHEAD = 3

// How many script words have been read: each heard word may match within a short window ahead,
// so a misheard or skipped word doesn't stall the cursor and a stray word doesn't jump it.
export function followWords(script: string[], heard: string[]): number {
  let pos = 0
  for (const h of heard) {
    const end = Math.min(script.length, pos + LOOKAHEAD + 1)
    for (let j = pos; j < end; j++) {
      if (script[j] === h) {
        pos = j + 1
        break
      }
    }
  }
  return pos
}

type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  processLocally?: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecCtor = (new () => Rec) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>
}

const Ctor = (globalThis as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }).SpeechRecognition

// Only on-device recognition: audio must not leave the browser for this reading aid.
// ponytail: no highlighting where Chrome can't recognise locally; add a consented cloud mode if users ask.
async function localRecognitionReady(lang: string) {
  if (!Ctor?.available) return false
  const o = { langs: [lang], processLocally: true }
  try {
    const state = await Ctor.available(o)
    if (state === 'available') return true
    // One-time on-device model download; highlighting starts once it is installed.
    if ((state === 'downloadable' || state === 'downloading') && Ctor.install) return await Ctor.install(o)
  } catch {
    /* unsupported: plain text */
  }
  return false
}

export function useSpeechFollow(text: string, active: boolean, lang = 'en-US') {
  const [read, setRead] = useState(0)
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    if (active && !supported) void localRecognitionReady(lang).then(setSupported)
  }, [active, supported, lang])
  useEffect(() => {
    if (!active || !supported || !Ctor) return
    const script = tokenize(text)
    const r = new Ctor()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.processLocally = true
    let stopped = false
    let before = '' // text from earlier sessions: Chrome ends a session on long pauses
    let current = ''
    r.onresult = (e) => {
      current = Array.from(e.results, (x) => x[0].transcript).join(' ')
      setRead(followWords(script, tokenize(before + ' ' + current)))
    }
    r.onend = () => {
      before += ' ' + current
      current = ''
      if (!stopped) r.start()
    }
    setRead(0)
    r.start()
    return () => {
      stopped = true
      r.stop()
    }
  }, [active, supported, text, lang])
  return { read, supported }
}
