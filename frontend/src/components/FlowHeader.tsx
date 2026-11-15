import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const BackIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
)

export function FlowHeader({ back, children }: { back?: string; children: ReactNode }) {
  return (
    <header className="rs-nav" style={{ padding: '0 max(20px, calc((100% - 1200px) / 2 + 40px))', borderBottom: 0 }}>
      {back ? (
        <Link className="rs-iconbtn" to={back} aria-label="Back">
          <BackIcon />
        </Link>
      ) : (
        <span style={{ width: 'var(--tap)' }} />
      )}
      <div style={{ flex: 1, maxWidth: 520 }}>{children}</div>
      <span className="d-only" style={{ width: 120 }} />
    </header>
  )
}
