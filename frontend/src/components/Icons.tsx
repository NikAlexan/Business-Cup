export const Logo = () => (
  <span aria-hidden="true" className="rs-logo">
    <i style={{ height: 8, background: 'var(--sun)' }} />
    <i style={{ height: 15, background: 'var(--primary)' }} />
    <i style={{ height: 10, background: 'var(--sun)' }} />
  </span>
)
export const StreakIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="9" width="3" height="6" rx="1.5" fill="var(--sun-edge)" />
    <rect x="7" y="5" width="3" height="14" rx="1.5" fill="var(--sun-edge)" />
    <rect x="12" y="2" width="3" height="20" rx="1.5" fill="var(--sun-edge)" />
    <rect x="17" y="7" width="3" height="10" rx="1.5" fill="var(--sun-edge)" />
  </svg>
)
export const NoteIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 18V5l11-2v13" fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6.5" cy="18" r="3" fill="var(--primary)" />
    <circle cx="17.5" cy="16" r="3" fill="var(--primary)" />
  </svg>
)
export const ClockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--sky)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)
export const Check = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5 9-10" />
  </svg>
)
const s = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
export const HomeIcon = () => <svg {...s}><path d="M4 11l8-7 8 7v9H4z" /></svg>
export const ChartIcon = () => <svg {...s}><path d="M5 20V10M12 20V4M19 20v-7" /></svg>
export const GearIcon = () => (
  <svg {...s}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </svg>
)
