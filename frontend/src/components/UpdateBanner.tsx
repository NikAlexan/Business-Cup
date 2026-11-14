import { useRegisterSW } from 'virtual:pwa-register/react'

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="rs-banner rs-banner--info rs-update" role="status">
      <span style={{ flex: 1 }}>New version available.</span>
      <button className="rs-btn rs-btn--quiet" type="button" onClick={() => updateServiceWorker(true)}>Reload</button>
      <button className="rs-link" type="button" onClick={() => setNeedRefresh(false)} style={{ fontSize: 15 }}>Later</button>
    </div>
  )
}
