import { useEffect, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/api'
import { useMe } from '../api/hooks'
import { ChartIcon, GearIcon, HomeIcon, Logo } from './Icons'
import { RewardChips } from './RewardChips'
import { UpdateBanner } from './UpdateBanner'

const NAV = [
  { to: '/today', label: 'Today', icon: <HomeIcon /> },
  { to: '/progress', label: 'Progress', icon: <ChartIcon /> },
  { to: '/settings', label: 'Settings', icon: <GearIcon /> },
]

export function useRedirectOn401(error: unknown) {
  const navigate = useNavigate()
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) navigate('/', { replace: true })
  }, [error, navigate])
}

export function Chips() {
  const { data } = useMe()
  if (!data) return null
  const p = data.progress
  return <RewardChips streak={p.current_streak_days} notes={p.notes_total} seconds={p.practice_seconds_total} />
}

const gutter = { padding: '0 max(20px, calc((100% - 1200px) / 2 + 40px))' }

export function AppShell({ children, chips = true }: { children: ReactNode; chips?: boolean }) {
  const me = useMe()
  useRedirectOn401(me.error)
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? ' rs-nav__link--on' : '')
  return (
    <div className="rs rs-page">
      <header className="rs-nav" style={gutter}>
        <NavLink to="/today" className="rs-brand">
          <Logo /> Resonance
        </NavLink>
        <nav className="rs-nav__links" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={(s) => 'rs-nav__link' + cls(s)}>
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
        {chips ? <Chips /> : <span />}
      </header>
      <main className="rs-wrap" style={{ paddingTop: 28, paddingBottom: 40 }}>
        {children}
      </main>
      <UpdateBanner />
      <nav className="rs-tabs" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => 'rs-tab' + (isActive ? ' rs-tab--on' : '')}>
            {n.icon}
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

// Onboarding/flow screens: logo bar only, no tabs (as in the mockups).
export function FlowShell({ children, narrow = true }: { children: ReactNode; narrow?: boolean }) {
  return (
    <div className="rs rs-page">
      <header className="rs-nav" style={gutter}>
        <NavLink to="/" className="rs-brand">
          <Logo /> Resonance
        </NavLink>
      </header>
      <main className={narrow ? 'rs-wrap rs-narrow' : 'rs-wrap'} style={{ paddingTop: 28, paddingBottom: 40 }}>
        {children}
      </main>
    </div>
  )
}
