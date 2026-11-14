import { useEffect, useState } from 'react'

type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export function useInstallPrompt() {
  const [event, setEvent] = useState<PromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as PromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  const isStandalone =
    installed || window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return {
    canInstall: !!event && !isStandalone,
    isIos,
    isStandalone,
    install: async () => {
      if (!event) return
      await event.prompt()
      await event.userChoice
      setEvent(null)
    },
  }
}
