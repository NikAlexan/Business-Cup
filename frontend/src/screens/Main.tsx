import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { post, useMutationWithKey } from '../api/api'
import { useMe } from '../api/hooks'
import { Logo } from '../components/Icons'
import { ErrorBanner } from '../components/ui'

const GOALS = [
  { id: 'clear_speech', title: 'Clearer speech', meta: 'Crisp words, steady pace' },
  { id: 'expressive_voice', title: 'More expressive voice', meta: 'Intonation and stress' },
  { id: 'confident_delivery', title: 'Confident delivery', meta: 'Steady, assured reads' },
]
const HERO = [30, 45, 38, 60, 52, 72, 58, 80, 64, 88, 70, 94, 76, 100]

export default function Main() {
  const me = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [goal, setGoal] = useState('clear_speech')
  const [consent, setConsent] = useState(false)

  useEffect(() => {
    const d = me.data
    if (d?.onboarding_status === 'ready') navigate('/today', { replace: true })
    else if (d?.onboarding_status === 'assessment_in_progress')
      navigate('/record?assessment_id=' + d.active_assessment_id, { replace: true })
  }, [me.data, navigate])

  const start = useMutationWithKey((body: object, key) => post('/guest-session', body, key))
  const submit = () =>
    start.mutate(
      {
        goal,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: 'en-US',
        consent: { audio_processing: true, policy_version: '2026-11-14' },
      },
      {
        onSuccess: async () => {
          await qc.invalidateQueries({ queryKey: ['me'] })
          navigate('/mic-check')
        },
      },
    )

  return (
    <div className="rs rs-page">
      <header className="rs-nav" style={{ padding: '0 max(20px, calc((100% - 1200px) / 2 + 40px))', borderBottom: 0 }}>
        <span className="rs-brand">
          <Logo /> Resonance
        </span>
        <span className="rs-label d-only">No sign-up needed</span>
      </header>
      <div className="rs-wrap" style={{ paddingTop: 40, paddingBottom: 56 }}>
        <div className="rs-cols" style={{ alignItems: 'center' }}>
          <div className="rs-stack" style={{ gap: 24 }}>
            <div className="rs-stack" style={{ gap: 12 }}>
              <h1 className="rs-h rs-hero-title" style={{ lineHeight: 1.05 }}>
                Train your voice in five minutes a day
              </h1>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 19, maxWidth: '34ch' }}>
                Record three short tasks, get a voice profile and a 14-session plan.
              </p>
            </div>
            <h2 className="rs-h" style={{ fontSize: 20 }}>
              What do you want to work on?
            </h2>
            <div role="radiogroup" aria-label="Goal" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={'rs-opt' + (goal === g.id ? ' rs-opt--on' : '')}
                  role="radio"
                  aria-checked={goal === g.id}
                  onClick={() => setGoal(g.id)}
                >
                  <span className="rs-opt__icon" style={goal === g.id ? { background: 'var(--primary)', color: 'var(--primary-ink)' } : undefined}>
                    {goal === g.id ? '✓' : ''}
                  </span>
                  <span>
                    <span className="rs-opt__title">{g.title}</span>
                    <span className="rs-opt__meta">{g.meta}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="rs-stack" style={{ gap: 12, maxWidth: 520 }}>
              <label htmlFor="consent" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 15, lineHeight: 1.45, cursor: 'pointer' }}>
                <input
                  id="consent"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={{ width: 22, height: 22, margin: '1px 0 0', flex: 'none', accentColor: 'var(--primary-edge)' }}
                />
                <span>I agree that my recordings are processed to measure my voice and write feedback.</span>
              </label>
              {start.error && <ErrorBanner error={start.error} onRetry={submit} />}
              <button className="rs-btn rs-btn--wide" type="button" disabled={!consent || start.isPending} onClick={submit} style={{ alignSelf: 'flex-start' }}>
                {start.isPending ? 'Starting…' : 'Get started'}
              </button>
              <p className="rs-label" style={{ margin: 0 }}>
                No sign-up. Your progress stays in this browser.
              </p>
            </div>
          </div>
          <div className="d-only" style={{ background: 'var(--stage)', borderRadius: 32, padding: 40, color: 'var(--stage-ink)', minHeight: 560, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 20 }}>
            <h2 className="rs-h" style={{ fontSize: 26, maxWidth: '16ch' }}>
              A 14-session plan built from your own recording
            </h2>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180 }} aria-hidden="true">
              {HERO.map((h, i) => (
                <i key={i} style={{ flex: 1, height: h + '%', borderRadius: 10, background: i < 5 ? 'var(--sun)' : i === 5 ? 'var(--primary)' : 'rgba(255,255,255,.16)' }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="rs-chip" style={{ color: 'var(--ink)' }}>5–8 min a day</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
