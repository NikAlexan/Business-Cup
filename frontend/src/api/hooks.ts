import { useQuery } from '@tanstack/react-query'
import { request } from './api'
import type { Assessment, Exercise, Job, Me, Plan, Progress, Today } from './types'

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => request<Me>('/me') })
export const useToday = () => useQuery({ queryKey: ['today'], queryFn: () => request<Today>('/today') })
export const usePlan = () => useQuery({ queryKey: ['plan'], queryFn: () => request<Plan>('/plan') })
export const useProgress = () => useQuery({ queryKey: ['progress'], queryFn: () => request<Progress>('/progress') })
export const useAssessment = (id: string | undefined) =>
  useQuery({ queryKey: ['assessment', id], queryFn: () => request<Assessment>('/assessments/' + id), enabled: !!id })
export const useExercises = () =>
  useQuery({ queryKey: ['exercises'], queryFn: () => request<{ items: Exercise[] }>('/exercises'), staleTime: Infinity })
export const useExercise = (id: string | undefined) =>
  useQuery({ queryKey: ['exercise', id], queryFn: () => request<Exercise>('/exercises/' + id), enabled: !!id, staleTime: Infinity })

const DONE = new Set(['completed', 'needs_rerecord', 'failed'])
export const jobPollInterval = (job: Job | undefined) =>
  job && DONE.has(job.status) ? false : (job?.poll_after_ms ?? 2000)

export const useJob = (id: string | null | undefined) =>
  useQuery({
    queryKey: ['job', id],
    queryFn: () => request<Job>('/jobs/' + id),
    enabled: !!id,
    refetchInterval: (q) => jobPollInterval(q.state.data),
  })
