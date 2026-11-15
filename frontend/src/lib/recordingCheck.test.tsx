// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { useRecordingCheck } from './recordingCheck'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('a cached accepted job submits its recording once during StrictMode effect replay', async () => {
  const onChecked = vi.fn()
  const fetch = vi.fn(() => { throw Error('The cached terminal job needs no network fetch') })
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['job', 'accepted-job'], { status: 'completed' })
  function Recovered() {
    const check = useRecordingCheck({ pendingTake: { recording_id: 'accepted-recording', job_id: 'accepted-job', status: 'completed', practice_only: false },
      fields: { purpose: 'exercise', plan_item_id: 'item' }, blob: null, mime: null, onChecked })
    return <p>{check.checking ? 'Checking' : 'Checked'}</p>
  }
  render(<StrictMode><QueryClientProvider client={client}><Recovered /></QueryClientProvider></StrictMode>)
  await waitFor(() => expect(onChecked).toHaveBeenCalledTimes(1))
  expect(onChecked.mock.calls[0][0]).toBe('accepted-recording')
  expect(fetch).not.toHaveBeenCalled()
})
