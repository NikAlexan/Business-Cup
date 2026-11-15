import { Link, Navigate } from 'react-router-dom'
import { useMe } from '../api/hooks'
import { AppShell } from '../components/AppShell'
import { Skeleton } from '../components/ui'
import { formatDate } from '../lib/format'

export default function CheckIn() {
  const me = useMe()
  if (!me.data) return <AppShell><Skeleton height={280} /></AppShell>
  if (!me.data.capabilities?.daily_training) return <Navigate to="/paywall" replace />
  const r = me.data.reassessment
  return (
    <AppShell>
      <div className="rs-stack rs-gap-5">
        <h1 className="rs-h rs-h1">Your 14-day check-in</h1>
        <div className="rs-cols">
          <div className="rs-card rs-stack" style={{ gap: 12, padding: 24 }}>
            <h2 className="rs-h rs-h3">Three recording tasks</h2>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>The same control passage as your baseline</li>
              <li>A fresh unfamiliar passage</li>
              <li>The same expression task</li>
            </ol>
            <p style={{ margin: 0 }}>Use the same mic, distance and room so the numbers compare. Then you get a report and a new plan.</p>
            <p style={{ margin: 0, fontSize: 15, color: 'var(--muted)' }}>
              Numbers describe these recordings only. Some changes may be day-to-day variation.
            </p>
          </div>
          <div className="rs-stack" style={{ gap: 14, alignItems: 'flex-start' }}>
            {r.available ? (
              <Link className="rs-btn rs-btn--wide" to="/mic-check?kind=reassessment">Start check-in</Link>
            ) : (
              <>
                <div className="rs-banner rs-banner--info" role="status" style={{ width: '100%' }}>
                  <span>
                    {r.next_available_on ? `Your check-in opens on ${formatDate(r.next_available_on, r.timezone)}.` : 'Finish your voice profile first.'}
                  </span>
                </div>
                {r.demo_override_available && (
                  <div className="rs-card rs-stack" style={{ gap: 10, padding: 20, border: '2px dashed var(--warning)', background: 'var(--warning-tint)', width: '100%' }}>
                    <span className="rs-badge" style={{ background: 'var(--ground)', color: 'var(--warning)', alignSelf: 'flex-start' }}>DEMO_MODE</span>
                    <p style={{ margin: 0, fontSize: 15 }}>
                      Demo mode lets you run the check-in before day 14. The result is marked Demo.
                    </p>
                    <Link className="rs-btn rs-btn--sun" to="/mic-check?kind=reassessment&demo=1" style={{ alignSelf: 'flex-start' }}>
                      Run demo check-in
                    </Link>
                  </div>
                )}
              </>
            )}
            {me.data.latest_assessment_id && (
              <Link className="rs-link" to={'/profile/' + me.data.latest_assessment_id} style={{ fontSize: 15 }}>
                See my latest profile
              </Link>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
