// Hand-written from app/service.py responses. ponytail: generate from OpenAPI once the API churns.
export type Measurement = {
  available: boolean
  value: number | { p10: number; p90: number } | null
  unit: string
  unavailable_reason: string | null
  points?: { time_seconds: number; value: number | null }[]
}
export type Reassessment = {
  next_available_on: string | null
  timezone: string
  available: boolean
  demo_override_available: boolean
}
export type Streak = { current_days: number; longest_days: number; last_practice_on: string | null }
export type Me = {
  guest_id: string
  capabilities?: { exercise_coaching?: boolean; assessment?: boolean; daily_training?: boolean }
  data_provenance?: { prepared_demo_history: boolean }
  preferences: { goal: string; timezone: string; locale: string }
  demo_mode: boolean
  limits: {
    max_file_bytes: number
    max_recording_seconds: number
    max_assessment_total_seconds: number
    accepted_audio_types: string[]
  }
  onboarding_status: 'needs_assessment' | 'assessment_in_progress' | 'ready'
  active_assessment_id: string | null
  latest_assessment_id: string | null
  current_plan_id: string | null
  reassessment: Reassessment
  progress: {
    completed_lessons: number
    total_lessons: number
    current_streak_days: number
    longest_streak_days: number
    notes_total: number
    practice_seconds_total: number
  }
}
export type VerificationType = 'timer' | 'self_confirmation' | 'recording'
export type PlanItem = {
  id: string
  exercise_id: string
  position: number
  variant_label?: string
  difficulty?: string
  title: string
  reason: string
  status: 'pending' | 'completed'
  latest_attempt_id: string | null
  estimated_duration_seconds: number
  notes_available: number
  task: {
    instruction: string
    repetitions?: number
    steps?: string[]
    reflection_prompt?: string
    timing?: { expected_recording_seconds: { min: number; max: number } | null; includes_listening: boolean }
    text: string
    example: { type: string; text: string; audio_url: string | null }
    verification: {
      type: VerificationType
      min_elapsed_seconds: number | null
      max_recording_seconds: number | null
      target_wpm: { min: number; max: number } | null
    }
  }
}
export type Lesson = {
  id: string
  day_index: number
  status: 'locked' | 'available' | 'in_progress' | 'completed'
  estimated_duration_seconds: number
  completed_at: string | null
  completed_on?: string | null
  items: PlanItem[]
}
export type Plan = {
  id: string
  assessment_id: string
  status: string
  total_lessons: number
  completed_lessons: number
  lessons: Lesson[]
}
export type Today = {
  local_date: string
  timezone: string
  plan_id: string | null
  lesson: Lesson | null
  daily_status: 'available' | 'in_progress' | 'completed' | 'plan_completed' | 'needs_assessment'
  next_lesson_available_on: string | null
  streak: Streak
  reassessment: Reassessment
}
export type Issue = { code: string; message: string }
export type Recording = {
  training_focus?: TrainingFocus | null
  id: string
  status: 'queued' | 'processing' | 'completed' | 'needs_rerecord' | 'failed'
  duration_seconds: number | null
  quality: { status: string; issues: Issue[] } | null
  audio_url: string
  created_at: string
  purpose: string
  plan_item_id: string | null
}
export type AssessmentTask = {
  pending_take?: PendingTake | null
  id: string
  kind: string
  order: number
  text: string
  instruction: string
  target_duration_seconds: number
  max_duration_seconds: number
  recording_id: string | null
  quality_status: string | null
}
export type Comparison = {
  audio_pairs?: { kind: string; before_audio_url: string; after_audio_url: string }[]
  comparable: boolean
  summary: string
  limitations: string[]
  metrics: Record<string, { available: boolean; before: unknown; after: unknown; delta: number | null; unit: string }>
}
export type Assessment = {
  recording_conditions?: { device_label: string | null; distance_cm: number | null; environment: string; notes?: string | null }
  id: string
  kind: 'initial' | 'reassessment'
  status: string
  tasks: AssessmentTask[]
  job_id: string | null
  plan_id: string | null
  demo_override_used: boolean
  analysis_metadata?: { demo?: { prepared_data?: boolean } }
  completed_at: string | null
  report: {
    summary: string
    observations: { category: string; text: string }[]
    limitations: string[]
    priorities: { tag: string; reason: string; exercise_ids: string[] }[]
  } | null
  measurements: Record<string, Measurement> | null
  comparison: Comparison | null
  interpretation?: Record<string, MetricInterpretation> | null
  recordings?: Recording[]
}
export type MetricInterpretation = {
  band: 'below' | 'within' | 'above' | null
  target: { min: number; max: number; unit?: string } | null
  label: string
  note: string
  focus: boolean
}
export type Job = {
  id: string
  type: string
  status: 'queued' | 'processing' | 'completed' | 'needs_rerecord' | 'failed'
  stage: string | null
  poll_after_ms: number | null
  result: { assessment_id?: string; plan_id?: string } | null
  error: { code: string; message: string } | null
  retryable: boolean
}
export type Reward = { notes: number; parts: { notes: number; reason: 'exercise_completed' | 'quality_bonus' }[] }
export type Attempt = {
  exercise_id?: string
  training_focus?: TrainingFocus | null
  focus_check?: { outcome: FocusOutcome; source: 'user_listening'; updated_at: string }
  speech_review?: {
    status: 'queued' | 'processing' | 'completed' | 'unavailable' | 'failed'
    job_id: string | null
    reason?: string | null
    report: { summary: string; observation: { text: string; evidence: { note?: string; quote: string; start_seconds: number; end_seconds: number } } | null; next_step: string; listening_question: string; limitations: string[] } | null
  }
  reflection?: { note: string; updated_at: string }
  practice_focus?: { attempt_id: string; note: string } | null
  practice_only?: boolean
  created_at?: string
  recording_id?: string | null
  id: string
  plan_item_id: string
  status: 'passed' | 'needs_retry'
  reward: Reward
  practice_seconds: number
  feedback: { version?: string; scope?: string; insights?: { code: string; source: string; message: string; evidence: { note?: string; quote: string; start_seconds: number; end_seconds: number } | null }[]; next_step?: string | null; summary: string; issues: Issue[]; coaching?: Issue[]; metrics?: Record<string, Measurement> | null }
}
export type Completion = {
  lesson_id: string
  completed_lessons: number
  total_lessons: number
  streak: Streak
  session_reward: { notes: number; practice_seconds: number }
  next_lesson_available_on: string | null
}
export type Progress = {
  timezone: string
  summary: {
    completed_lessons_all_time: number
    current_plan_completed_lessons: number
    current_plan_total_lessons: number
    current_streak_days: number
    longest_streak_days: number
    last_practice_on: string | null
    notes_total: number
    practice_seconds_total: number
  }
  activity: { date: string; completed_lessons: number }[]
  measurement_history: { assessment_id: string; completed_at: string; measurements: Record<string, Measurement> }[]
  recordings: Recording[]
  next_recordings_cursor: string | null
  reassessment: Reassessment
}
export type Exercise = {
  id: string
  title: string
  goal: string
  instruction: string
  duration_seconds: number
  tags: string[]
}

export type PendingTake = { training_focus?: TrainingFocus | null; based_on_attempt_id?: string | null; practice_focus?: { attempt_id: string; note: string } | null; recording_id: string; job_id: string; practice_only: boolean; status: string }
export type PlanItemState = { training_focus?: TrainingFocus | null; plan_id: string; plan_status: string; lesson: Lesson; item: PlanItem; item_index: number; pending_take: PendingTake | null }

export type FocusOutcome = 'heard' | 'partly' | 'not_yet' | 'unsure'
export type TrainingFocus = {
  id: string; note: string; skill: string; skill_label: string; listening_question: string
  steps: string[]; rubric_version: string; created_at: string
  source_attempt_id: string; source_plan_item_id: string; source_recording_id: string
}
export type PracticeFocusState = {
  focus: TrainingFocus | null
  skills: Record<string, { label: string; question: string; exercise_ids: string[] }>
  last_check: { outcome: FocusOutcome; source: 'user_listening'; attempt_id: string; updated_at: string } | null
}
