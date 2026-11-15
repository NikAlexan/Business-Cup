import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { request } from './api'
import type { PracticeFocusState, Assessment, Attempt, Exercise, Job, Me, Plan, PlanItemState, Progress, Recording, Today } from './types'

export const useMe = (enabled = true) => useQuery({ queryKey: ['me'], queryFn: () => request<Me>('/me'), enabled })
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

export const useAttempt = (id: string | null | undefined) =>
  useQuery({ queryKey: ['attempt', id], queryFn: () => request<Attempt>('/exercise-attempts/' + id), enabled: !!id })

export const useRecording = (id: string | null | undefined) =>
  useQuery({ queryKey: ['recording', id], queryFn: () => request<Recording>('/recordings/' + id), enabled: !!id })

export const useAttemptHistory = (planItemId: string | undefined) =>
  useInfiniteQuery({
    queryKey: ['attempt-history', planItemId],
    enabled: !!planItemId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ plan_item_id: planItemId!, limit: '20' })
      if (pageParam) query.set('cursor', pageParam)
      return request<{ items: Attempt[]; next_cursor: string | null }>('/exercise-attempts?' + query)
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })

export const usePlanItem = (id: string) =>
  useQuery({ queryKey: ['plan-item', id], queryFn: () => request<PlanItemState>('/plan-items/' + id), enabled: !!id })

export const usePracticeFocus = (enabled = true) => useQuery({ queryKey: ['practice-focus'], queryFn: () => request<PracticeFocusState>('/practice-focus'), enabled })
