import type { Attempt, PracticeIntent } from '../api/types'
import { newestReflection } from './attemptView'

// A saved decision governs future practice; the objective printed for the recorded take stays frozen.
export function nextListeningIntent(take: Attempt, refreshed?: Attempt): PracticeIntent | undefined {
  return newestReflection(take.reflection, refreshed?.id === take.id ? refreshed.reflection : undefined)?.intent ?? (take.training_focus ?? take.practice_focus)?.intent
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
