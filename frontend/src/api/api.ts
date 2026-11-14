import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message)
  }
}

type Init = { method?: string; body?: unknown; form?: FormData; idempotencyKey?: string }

export async function request<T>(path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey
  const res = await fetch('/api/v1' + path, {
    method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const e = data?.error ?? {}
    if (res.status === 401) throw new ApiError(401, 'unauthorized', e.message ?? 'Session expired.')
    throw new ApiError(res.status, e.code ?? 'http_' + res.status, e.message ?? 'Something went wrong.', e.details)
  }
  return data as T
}

export function queryRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false
  return error instanceof TypeError || (error instanceof ApiError && error.status >= 500)
}

export type KeyState = { key: string; body: string }

// Same body after a failure reuses the key so the server can replay; a new body gets a new key.
export function nextKey(prev: KeyState | null, body: unknown): KeyState {
  const s = JSON.stringify(body ?? null)
  return prev && prev.body === s ? prev : { key: crypto.randomUUID(), body: s }
}

export function useMutationWithKey<TVars, TRes>(fn: (vars: TVars, key: string) => Promise<TRes>) {
  const last = useRef<KeyState | null>(null)
  return useMutation<TRes, Error, TVars>({
    mutationFn: (vars) => {
      last.current = nextKey(last.current, vars)
      return fn(vars, last.current.key)
    },
    onSuccess: () => {
      last.current = null
    },
  })
}

export const post = <T,>(path: string, body: unknown, key: string) =>
  request<T>(path, { method: 'POST', body, idempotencyKey: key })
