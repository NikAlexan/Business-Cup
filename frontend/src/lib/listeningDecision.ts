import type { Attempt, PracticeIntent } from '../api/types'

const fractionAfterMilliseconds = (stamp?: string) =>
  (stamp?.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '').padEnd(9, '0').slice(3, 9)

// A saved decision governs future practice; the objective printed for the recorded take stays frozen.
export function nextListeningIntent(take: Attempt, refreshed?: Attempt): PracticeIntent | undefined {
  const shown = take.reflection
  const received = refreshed?.reflection
  const receivedAt = Date.parse(received?.updated_at ?? '')
  const shownAt = Date.parse(shown?.updated_at ?? '')
  const later = receivedAt > shownAt || (receivedAt === shownAt && fractionAfterMilliseconds(received?.updated_at) > fractionAfterMilliseconds(shown?.updated_at))
  const newer = received?.intent && (!shown?.intent || (Number.isFinite(receivedAt) && (!Number.isFinite(shownAt) || later)))
  return (newer ? received?.intent : shown?.intent) ?? (take.training_focus ?? take.practice_focus)?.intent
}

export function listeningDecision(intent: PracticeIntent | undefined) {
  if (intent === 'keep') return {
    step: 'Listen for the feature you wanted to keep. Carry it into a new phrase without automatically making it stronger.',
    question: 'Can you hear the useful feature you chose to keep, without needing to make it stronger?',
  }
  if (intent === 'undecided') return {
    step: 'Listen to one phrase again before deciding whether to change anything. A new take is optional.',
    question: 'What do you hear in this phrase, and is there enough reason to choose a change?',
  }
  return null
}
