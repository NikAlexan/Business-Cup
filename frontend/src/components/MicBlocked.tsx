import type { MicErrorKind } from '../lib/recorder'

const COPY: Record<MicErrorKind, { title: string; badge: string; steps: string[] }> = {
  denied: {
    title: 'Your browser blocked the microphone',
    badge: 'Mic access denied',
    steps: /Mac/.test(navigator.userAgent)
      ? ['Click the lock icon next to the address bar', 'Set Microphone to Allow', 'If it is still blocked: System Settings → Privacy & Security → Microphone', 'Come back and press Try again']
      : ['Click the lock icon next to the address bar', 'Set Microphone to Allow', 'Come back and press Try again'],
  },
  not_found: { title: 'No microphone found', badge: 'No input device', steps: ['Plug in or turn on a microphone', 'Check it is selected as the input in your system settings', 'Press Try again'] },
  insecure: { title: 'This page cannot use the microphone', badge: 'Not a secure page', steps: ['Open the app over https (or on localhost)', 'Press Try again'] },
  timeout: { title: 'The microphone request is still waiting', badge: 'No answer from the browser', steps: ['Look for a permission prompt near the address bar', 'Allow the microphone', 'Press Try again'] },
  unsupported: { title: 'This browser cannot record audio here', badge: 'Recording not supported', steps: ['Use a recent Chrome, Edge, Firefox or Safari', 'Press Try again'] },
  unknown: { title: "We couldn't start the microphone", badge: 'Mic unavailable', steps: ['Close other apps that use the microphone', 'Press Try again'] },
}

export function MicBlocked({ kind, onRetry }: { kind: MicErrorKind; onRetry: () => void }) {
  const c = COPY[kind]
  return (
    <div className="rs-stack" style={{ gap: 20 }}>
      <div className="rs-stack" style={{ gap: 8 }}>
        <h1 className="rs-h rs-h1">{c.title}</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>We need it to hear your voice. Nothing is recorded until you press Record.</p>
      </div>
      <div className="rs-cols" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="rs-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '32px 20px', background: 'var(--danger-tint)' }}>
          <span className="rs-badge" style={{ background: 'var(--ground)', color: 'var(--danger)' }}>
            {c.badge}
          </span>
        </div>
        <ol className="rs-stack" style={{ gap: 14, margin: 0, padding: 0, listStyle: 'none' }}>
          {c.steps.map((s, i) => (
            <li key={s} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span className="rs-opt__icon" style={{ width: 32, height: 32, background: 'var(--sky-tint)', color: 'var(--sky)', fontSize: 14 }}>
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
          <li className="rs-stack" style={{ gap: 10, marginTop: 8 }}>
            <button className="rs-btn rs-btn--wide" type="button" onClick={onRetry} style={{ alignSelf: 'flex-start' }}>
              Try again
            </button>
            <p className="rs-label" style={{ margin: 0 }}>Opened from another device or a link? The page must use https.</p>
          </li>
        </ol>
      </div>
    </div>
  )
}
