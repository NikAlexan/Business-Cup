// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { RecorderDock } from '../components/RecorderDock'
import type { useRecorder } from './recorder'
import { pauseOtherAudio, useExclusiveAudio } from './audioPlayback'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Players({ route, showFirst = true }: { route: string; showFirst?: boolean }) {
  useExclusiveAudio(route)
  return <>{showFirst && <audio data-testid="first" />}<audio data-testid="second" /></>
}

test('playing another source, starting recording and navigation pause even a removed media element', () => {
  const view = render(<Players route="first-page" />)
  const first = screen.getByTestId('first') as HTMLAudioElement
  const second = screen.getByTestId('second') as HTMLAudioElement
  const playing = new Map<HTMLMediaElement, boolean>([[first, true], [second, false]])
  for (const player of [first, second]) Object.defineProperty(player, 'paused', { get: () => !playing.get(player) })
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { playing.set(this, false) })
  fireEvent.play(first)
  view.rerender(<Players route="first-page" showFirst={false} />)
  playing.set(second, true)
  fireEvent.play(second)
  expect(playing.get(first)).toBe(false)
  expect(pause).toHaveBeenCalledTimes(1)
  pauseOtherAudio() // The same operation runs synchronously before microphone permission is requested.
  expect(playing.get(second)).toBe(false)
  playing.set(second, true)
  fireEvent.play(second)
  view.rerender(<Players route="next-page" showFirst={false} />)
  expect(playing.get(second)).toBe(false)
})

test('Stop recording remains available while a network operation disables starting another take', () => {
  const stop = vi.fn()
  const r = { state: 'recording', level: { level: 0, status: 'waiting' }, error: null, stop, start: vi.fn(), reset: vi.fn() } as unknown as ReturnType<typeof useRecorder>
  render(<RecorderDock r={r} sending startDisabled onSend={vi.fn()} />)
  const button = screen.getByRole('button', { name: 'Stop recording' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  expect(stop).toHaveBeenCalledOnce()
})
