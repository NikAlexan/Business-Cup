import { useEffect } from 'react'

let active: HTMLAudioElement | null = null

export function pauseOtherAudio(except?: HTMLAudioElement) {
  if (typeof document === 'undefined') return
  const players = new Set(document.querySelectorAll<HTMLAudioElement>('audio'))
  if (active) players.add(active) // A removed player can still hold buffered media.
  players.forEach((audio) => { if (audio !== except && !audio.paused) audio.pause() })
  active = except ?? null
}

export function useExclusiveAudio(routeKey?: string) {
  useEffect(() => {
    const play = (event: Event) => { if (event.target instanceof HTMLAudioElement) pauseOtherAudio(event.target) }
    document.addEventListener('play', play, true)
    return () => { document.removeEventListener('play', play, true); pauseOtherAudio() }
  }, [routeKey])
}
