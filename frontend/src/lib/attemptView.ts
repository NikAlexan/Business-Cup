import type { Attempt } from '../api/types'

const fractionAfterMilliseconds = (stamp?: string) =>
  (stamp?.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '').padEnd(9, '0').slice(3, 9)

export function laterSavedTime(incoming?: string, shown?: string) {
  const receivedAt = Date.parse(incoming ?? '')
  const shownAt = Date.parse(shown ?? '')
  return Number.isFinite(receivedAt) && (!Number.isFinite(shownAt) || receivedAt > shownAt ||
    (receivedAt === shownAt && fractionAfterMilliseconds(incoming) > fractionAfterMilliseconds(shown)))
}

export function newestReflection(shown?: Attempt['reflection'], incoming?: Attempt['reflection'], mutationResponse = false) {
  if (!shown) return incoming
  if (!incoming) return shown
  const firstRevision = shown.revision ?? 0
  const nextRevision = incoming.revision ?? 0
  if (nextRevision !== firstRevision) return nextRevision > firstRevision ? incoming : shown
  if (laterSavedTime(incoming.updated_at, shown.updated_at)) return incoming
  if (laterSavedTime(shown.updated_at, incoming.updated_at)) return shown
  return mutationResponse ? incoming : shown
}

// Only mutable listening state is merged. Recording identity and practice objectives stay frozen.
export function reconcileAttempt(shown?: Attempt | null, incoming?: Attempt | null, mutationResponse = false): Attempt | null {
  if (!shown) return incoming ?? null
  if (!incoming || incoming.id !== shown.id) return shown
  return { ...shown,
    reflection: newestReflection(shown.reflection, incoming.reflection, mutationResponse),
    focus_check: !shown.focus_check || laterSavedTime(incoming.focus_check?.updated_at, shown.focus_check.updated_at) ? incoming.focus_check ?? shown.focus_check : shown.focus_check,
    speech_review: shown.speech_review?.report && !incoming.speech_review?.report ? shown.speech_review : incoming.speech_review ?? shown.speech_review,
  }
}
