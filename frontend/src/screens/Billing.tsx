import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { post, request, useMutationWithKey } from '../api/api'
import { useMe } from '../api/hooks'
import type { Me, Subscription } from '../api/types'
import { FlowShell } from '../components/AppShell'
import { FlowHeader } from '../components/FlowHeader'
import { Check } from '../components/Icons'
import { ErrorBanner, Skeleton } from '../components/ui'

type Plans = { plans: { interval: 'month' | 'year'; amount: number; currency: string }[]; trial_days: number }

// ponytail: assumes 2-decimal currencies; zero-decimal ones (JPY) would need Stripe's exponent table
export const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100)

export const PER = { month: 'mo', year: 'yr' } as const

export const usePlans = () =>
  useQuery({ queryKey: ['billing-plans'], queryFn: () => request<Plans>('/billing/plans'), staleTime: Infinity })

export const renewDate = (s: Subscription) =>
  s.current_period_end ? new Date(s.current_period_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function TestModeBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rs-banner rs-banner--info" style={{ alignItems: 'center' }}>
      <div style={{ fontSize: 15 }}>
        <b style={{ fontWeight: 500 }}>Test mode</b> — no real charges. {children}
      </div>
    </div>
  )
}

function Page({ back, label, children }: { back?: string; label: string; children: ReactNode }) {
  return (
    <div className="rs rs-page">
      <FlowHeader back={back}>
        <span className="rs-label">{label}</span>
      </FlowHeader>
      <main className="rs-wrap" style={{ paddingTop: 16, paddingBottom: 56 }}>
        {children}
      </main>
    </div>
  )
}

const PERKS = [
  '14 guided sessions from 12 exercise types, matched to your two priorities',
  'A check-in every 14 days: listen before and after, see measured changes',
  'A new plan after each check-in; older results stay in Progress',
]

const BARS = [30, 45, 38, 60, 52, 72, 58, 80, 64, 88, 70, 94, 76, 100]
const Lock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="3" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

// Hidden on phones so the plan picker stays within a short scroll.
const LockedPlan = () => (
  <div className="rs-card rs-stack d-only" style={{ gap: 12, padding: 24 }}>
    <div className="rs-eq" role="img" aria-label="14 locked sessions and a check-in">
      {BARS.map((h, i) => <i key={i} style={{ height: h + '%' }}><Lock /></i>)}
      <i className="c" style={{ height: '100%' }}><Check /></i>
    </div>
    <span className="rs-label">5–8 minutes a day · check-in on day 14</span>
  </div>
)

export function Paywall() {
  const me = useMe()
  const plans = usePlans()
  const [interval, setPeriod] = useState<'month' | 'year'>('month')
  const go = useMutationWithKey((v: { interval: string }, key) => post<{ url: string }>('/billing/checkout-session', v, key))
  const profile = me.data?.latest_assessment_id ? '/profile/' + me.data.latest_assessment_id : '/'
  const chosen = plans.data?.plans.find((p) => p.interval === interval)
  const trial = plans.data?.trial_days ?? 0
  const price = chosen ? money(chosen.amount, chosen.currency) : '…'
  return (
    <Page back={profile} label="Your profile is saved">
      <div className="rs-cols rs-paywall">
        <div className="rs-stack" style={{ gap: 20 }}>
          <div className="rs-stack" style={{ gap: 8 }}>
            <h1 className="rs-h rs-h1">Unlock your 14‑session plan</h1>
            <p style={{ margin: 0, color: 'var(--muted)', maxWidth: '46ch' }}>
              Built from your recording: pace and pauses first, then intonation range. Your profile stays free either way.
            </p>
          </div>
          <LockedPlan />
          <ul className="rs-stack" style={{ gap: 12, margin: 0, padding: 0, listStyle: 'none' }}>
            {PERKS.map((t) => (
              <li key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', color: 'var(--ink)' }}>
                <span style={{ color: 'var(--success)' }}><Check /></span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rs-card rs-stack" style={{ gap: 14, padding: 24, borderRadius: 28 }}>
          <h2 className="rs-h" style={{ fontSize: 22 }}>Choose a plan</h2>
          {plans.error ? (
            <ErrorBanner error={plans.error} onRetry={() => plans.refetch()} />
          ) : !plans.data ? (
            <Skeleton height={140} />
          ) : (
            <div role="radiogroup" aria-label="Billing period" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plans.data.plans.map((p) => (
                <button
                  key={p.interval}
                  type="button"
                  className={'rs-opt' + (p.interval === interval ? ' rs-opt--on' : '')}
                  role="radio"
                  aria-checked={p.interval === interval}
                  onClick={() => setPeriod(p.interval)}
                >
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <span className="rs-opt__title">{p.interval === 'month' ? 'Monthly' : 'Yearly'}</span>
                    <span className="rs-opt__meta">Renews every {p.interval}</span>
                  </span>
                  <span className="rs-h" style={{ fontSize: 20 }}>
                    {money(p.amount, p.currency)}
                    <span style={{ font: '400 14px var(--font-text)', color: 'var(--muted)' }}>/{PER[p.interval]}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {go.error && <ErrorBanner error={go.error} />}
          <button
            className="rs-btn"
            type="button"
            disabled={!chosen || go.isPending}
            onClick={() => go.mutate({ interval }, { onSuccess: (r) => window.location.assign(r.url) })}
          >
            {trial ? `Start ${trial}-day free trial` : 'Continue to checkout'}
          </button>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>
            {trial ? `Free for ${trial} days, then ${price}` : `${price} charged today, then`} every {interval} until you cancel. Cancel
            anytime in Settings → Subscription; access lasts to the end of the paid period. You'll pay on Stripe's secure page. By
            continuing you agree to the <Link to="/terms">Subscription terms</Link>.
          </p>
          <TestModeBanner>Use card 4242 4242 4242 4242, any future date and any CVC.</TestModeBanner>
          <Link className="rs-link" to={profile} style={{ alignSelf: 'center', fontSize: 15 }}>
            Not now
          </Link>
        </div>
      </div>
    </Page>
  )
}

export function PaySuccess() {
  // Access is opened only by the webhook, so poll /me until it lands.
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => request<Me>('/me'),
    refetchInterval: (q) => (q.state.data?.capabilities?.daily_training ? false : 2000),
  })
  const plans = usePlans()
  const ready = me.data?.capabilities?.daily_training
  const s = me.data?.subscription
  const plan = plans.data?.plans.find((p) => p.interval === s?.plan)
  return (
    <Page label={ready ? 'Payment complete' : 'Confirming payment'}>
      <div className="rs-stack" style={{ maxWidth: 640, margin: '16px auto 0', gap: 20 }}>
        <div className="rs-stack" style={{ alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <span style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--success-tint)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
            {ready ? <Check size={44} /> : <span className="rs-spin" aria-hidden="true" />}
          </span>
          <h1 className="rs-h rs-h1" aria-live="polite">{ready ? "You're in. Your plan is unlocked." : 'Confirming your payment…'}</h1>
        </div>
        {ready && s ? (
          <>
            <dl className="rs-card" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '10px 20px', padding: 24 }}>
              <dt className="rs-label">Plan</dt>
              <dd style={{ margin: 0 }}>
                {s.plan === 'year' ? 'Yearly' : 'Monthly'}
                {plan && ` · ${money(plan.amount, plan.currency)}`}
              </dd>
              <dt className="rs-label">{s.status === 'trialing' ? 'Trial ends' : 'Next renewal'}</dt>
              <dd style={{ margin: 0 }}>{renewDate(s)}</dd>
              <dt className="rs-label">Receipt</dt>
              <dd style={{ margin: 0 }}>Sent by Stripe to your email</dd>
              <dt className="rs-label">Mode</dt>
              <dd style={{ margin: 0 }}><span className="rs-badge" style={{ background: 'var(--sky-tint)', color: 'var(--sky)' }}>Test — no real charge</span></dd>
            </dl>
            <Link className="rs-btn rs-btn--wide" to="/today" style={{ alignSelf: 'center' }}>
              {me.data?.progress.completed_lessons ? 'Go to today' : 'Start session 1'}
            </Link>
          </>
        ) : (
          <p className="rs-label" style={{ margin: 0, textAlign: 'center' }}>Still confirming? Refresh in a minute — you won't be charged twice.</p>
        )}
      </div>
    </Page>
  )
}

export function PayCanceled() {
  const me = useMe()
  return (
    <Page back="/paywall" label="Checkout canceled">
      <div className="rs-stack" style={{ maxWidth: 640, margin: '16px auto 0', gap: 20 }}>
        <div className="rs-stack" style={{ gap: 8 }}>
          <h1 className="rs-h rs-h1">Checkout canceled. Nothing was charged.</h1>
          <p style={{ margin: 0, color: 'var(--muted)' }}>Your voice profile and recordings are saved in this browser.</p>
        </div>
        <div className="rs-banner rs-banner--warn">
          <div className="rs-stack" style={{ gap: 2 }}>
            <span style={{ fontWeight: 500 }}>Card declined in test mode?</span>
            <span style={{ fontSize: 15, color: 'var(--muted)' }}>Use 4242 4242 4242 4242. Test cards like 4000 0000 0000 0002 are meant to fail.</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link className="rs-btn rs-btn--wide" to="/paywall">Back to plans</Link>
          {me.data?.latest_assessment_id && (
            <Link className="rs-btn rs-btn--secondary rs-btn--wide" to={'/profile/' + me.data.latest_assessment_id}>See my profile</Link>
          )}
        </div>
      </div>
    </Page>
  )
}

const TERMS: [string, string][] = [
  ["What's free", 'Recording your baseline and seeing your voice profile. No sign-up and no card needed.'],
  [
    'What the subscription includes',
    "Your 14-session plan, daily exercises, a check-in every 14 days with a before-and-after comparison, and a new plan after each check-in. We don't promise a specific improvement: some check-ins show no clear change, and that's a normal result.",
  ],
  ['Cancel anytime', 'Settings → Subscription → Manage subscription. You keep access until the end of the period you paid for.'],
  [
    'No account',
    'Your progress and subscription are tied to this browser. Clearing cookies or switching devices loses access to them. Stripe emails your receipt. Deleting your data in Settings cancels the subscription.',
  ],
  [
    'Your recordings',
    'You confirm before any audio is sent for analysis. Recordings stay private, are processed to measure your voice and write feedback, and are deleted when you choose Delete my data.',
  ],
  ['Test mode', 'This prototype uses Stripe test mode. No real money is charged.'],
]

export function Terms() {
  const plans = usePlans()
  const prices = plans.data?.plans.map((p) => `${money(p.amount, p.currency)}/${PER[p.interval]}`).join(' or ')
  return (
    <FlowShell>
      <article className="rs-stack" style={{ gap: 14, fontSize: 17, lineHeight: 1.65 }}>
        <h1 className="rs-h rs-h1">Subscription terms</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>A plain-language summary.</p>
        {TERMS.slice(0, 2).map(([h, t]) => <Section key={h} h={h} t={t} />)}
        <Section
          h="Price and renewal"
          t={`${prices ?? 'Monthly or yearly'}, plus applicable tax.${plans.data?.trial_days ? ` The first ${plans.data.trial_days} days are free.` : ''} The subscription renews automatically at the end of each period until you cancel.`}
        />
        {TERMS.slice(2).map(([h, t]) => <Section key={h} h={h} t={t} />)}
        <Link className="rs-link" to="/paywall" style={{ fontSize: 15, marginTop: 12 }}>Back to plans</Link>
      </article>
    </FlowShell>
  )
}

const Section = ({ h, t }: { h: string; t: string }) => (
  <>
    <h2 className="rs-h" style={{ fontSize: 22, marginTop: 18 }}>{h}</h2>
    <p style={{ margin: 0 }}>{t}</p>
  </>
)
