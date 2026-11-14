import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { request } from '../api/api'
import { useMe } from '../api/hooks'
import { AppShell } from '../components/AppShell'
import { ErrorBanner, Skeleton } from '../components/ui'

const GOALS = [
  ['clear_speech', 'Clearer speech'],
  ['expressive_voice', 'More expressive voice'],
  ['confident_delivery', 'Confident delivery'],
]
const select = { height: 48, borderRadius: 14, border: '2px solid var(--line)', padding: '0 14px', font: '400 16px var(--font-text)', background: '#fff', color: 'var(--ink)' }
const ZONES: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []

export default function Settings() {
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  const save = useMutation({
    mutationFn: (body: object) => request('/preferences', { method: 'PATCH', body }),
    onSuccess: () => ['me', 'today', 'progress', 'plan'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  })
  const wipe = useMutation({
    mutationFn: () => request('/guest-data', { method: 'DELETE' }),
    onSuccess: () => {
      qc.clear()
      navigate('/', { replace: true })
    },
  })
  const pref = me.data?.preferences
  const zones = pref && !ZONES.includes(pref.timezone) ? [pref.timezone, ...ZONES] : ZONES

  return (
    <AppShell>
      <div className="rs-narrow rs-stack" style={{ gap: 24, margin: '0 auto' }}>
        <h1 className="rs-h rs-h1">Settings</h1>
        {!pref ? (
          <Skeleton height={200} />
        ) : (
          <div className="rs-card rs-stack" style={{ gap: 16, padding: 24 }}>
            <h2 className="rs-h" style={{ fontSize: 20 }}>Practice</h2>
            <div className="rs-stack" style={{ gap: 6 }}>
              <label htmlFor="goal" style={{ font: '500 15px var(--font-text)' }}>Goal</label>
              <select id="goal" style={select} value={pref.goal} disabled={save.isPending} onChange={(e) => save.mutate({ goal: e.target.value })}>
                {GOALS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
              <span className="rs-label">Your current plan stays as it is; the goal shapes the next one.</span>
            </div>
            <div className="rs-stack" style={{ gap: 6 }}>
              <label htmlFor="tz" style={{ font: '500 15px var(--font-text)' }}>Time zone</label>
              <select id="tz" style={select} value={pref.timezone} disabled={save.isPending} onChange={(e) => save.mutate({ timezone: e.target.value })}>
                {zones.map((z) => <option key={z} value={z}>{z === detected ? z + ' (detected)' : z}</option>)}
              </select>
              <span className="rs-label">Streaks and the check-in date follow this zone.</span>
            </div>
            {save.error && <ErrorBanner error={save.error} />}
            {save.isSuccess && <span className="rs-label" role="status" style={{ color: 'var(--success)' }}>Saved</span>}
          </div>
        )}
        <div className="rs-card rs-stack" style={{ gap: 12, padding: 24 }}>
          <h2 className="rs-h" style={{ fontSize: 20 }}>Your data</h2>
          <p style={{ margin: 0 }}>There's no account. Your profile, plan and recordings are tied to this browser. Clearing cookies or switching devices starts you fresh.</p>
          {!confirm ? (
            <button className="rs-btn rs-btn--secondary" type="button" onClick={() => setConfirm(true)} style={{ alignSelf: 'flex-start' }}>
              Delete my data…
            </button>
          ) : (
            <div className="rs-stack" style={{ gap: 12, border: '2px solid #ffc4bf', borderRadius: 18, padding: 16, background: '#fff' }}>
              <span style={{ fontWeight: 500 }}>Delete your recordings, profile and plan?</span>
              <span style={{ fontSize: 15, color: 'var(--muted)' }}>This can't be undone. Your streak and notes go too.</span>
              {wipe.error && <ErrorBanner error={wipe.error} />}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="rs-btn" type="button" disabled={wipe.isPending} onClick={() => wipe.mutate()} style={{ background: 'var(--danger)', color: '#fff', boxShadow: '0 3px 0 #a3201d' }}>
                  Delete my data
                </button>
                <button className="rs-btn rs-btn--secondary" type="button" onClick={() => setConfirm(false)}>
                  Keep my data
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
