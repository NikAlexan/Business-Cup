import { useSyncExternalStore } from 'react'

export type CancellationIntent = { guestId: string; itemId: string; uploadKey?: string; recordingId?: string }
const PREFIX = 'voice.cancellation.'
const EVENT = 'voice-cancellation-change'
const memory = new Map<string, string | null>()
const keyFor = (guestId: string, itemId: string) => PREFIX + guestId + '.' + itemId

function read(key: string | null) {
  if (!key) return null
  if (memory.has(key)) return memory.get(key) ?? null
  try { return localStorage.getItem(key) } catch { return null }
}

export function rememberCancellation(intent: CancellationIntent) {
  const key = keyFor(intent.guestId, intent.itemId)
  const value = JSON.stringify(intent)
  memory.set(key, value)
  try { localStorage.setItem(key, value) } catch { /* Keep the intent in memory if storage is unavailable. */ }
  window.dispatchEvent(new Event(EVENT))
}

export function forgetCancellation(guestId: string, itemId: string) {
  const key = keyFor(guestId, itemId)
  memory.set(key, null)
  try { localStorage.removeItem(key) } catch { /* No persistent value can be changed on this device. */ }
  window.dispatchEvent(new Event(EVENT))
}

export function clearCancellationIntents() {
  memory.clear()
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch { /* Guest deletion still clears in-memory state. */ }
  window.dispatchEvent(new Event(EVENT))
}

export function useCancellationIntent(guestId: string | undefined, itemId: string) {
  const key = guestId ? keyFor(guestId, itemId) : null
  const serialized = useSyncExternalStore((notify) => {
    const update = (event: Event) => {
      if (event instanceof StorageEvent) { if (event.key) memory.delete(event.key); else memory.clear() }
      notify()
    }
    window.addEventListener('storage', update); window.addEventListener(EVENT, update)
    return () => { window.removeEventListener('storage', update); window.removeEventListener(EVENT, update) }
  }, () => read(key), () => null)
  let intent: CancellationIntent | null = null
  try {
    const parsed = serialized ? JSON.parse(serialized) as CancellationIntent : null
    if (parsed?.guestId === guestId && parsed?.itemId === itemId &&
        ((typeof parsed.uploadKey === 'string' && parsed.uploadKey) || (typeof parsed.recordingId === 'string' && parsed.recordingId))) intent = parsed
  } catch { /* Malformed local data is never sent to the API. */ }
  let persistent = false
  try { persistent = !!key && localStorage.getItem(key) === serialized } catch { /* In-memory intent only. */ }
  return { intent, persistent }
}
