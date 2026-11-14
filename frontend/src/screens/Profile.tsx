import { Link, useParams } from 'react-router-dom'
import { useAssessment, useExercises, useMe } from '../api/hooks'
import { AppShell } from '../components/AppShell'
import { METRICS, MetricTile } from '../components/MetricTile'
import { ErrorBanner, Skeleton } from '../components/ui'
import { formatDate } from '../lib/format'

const TAG: Record<string, string> = {
  clarity: 'Clarity and endings',
  pace: 'Pace and pauses',
  pauses: 'Pace and pauses',
  intonation: 'Intonation range',
  articulation: 'Articulation',
  confidence: 'Confident delivery',
}
const label = (tag: string) => TAG[tag] ?? tag.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export default function Profile() {
  const { assessmentId } = useParams()
  const a = useAssessment(assessmentId)
  const me = useMe()
  const ex = useExercises()
  const title = (id: string) => ex.data?.items.find((x) => x.id === id)?.title
  const tz = me.data?.preferences.timezone ?? 'UTC'
  if (a.isPending) return <AppShell><Skeleton height={360} /></AppShell>
  if (a.error || !a.data) return <AppShell><ErrorBanner error={a.error} onRetry={() => a.refetch()} /></AppShell>
  const d = a.data
  const re = d.kind === 'reassessment'
  const m = d.measurements ?? {}
  return (
    <AppShell>
      <div className="rs-stack" style={{ gap: 24 }}>
        <div className="rs-stack" style={{ gap: 6 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <h1 className="rs-h rs-h1">{re ? 'Your check-in' : 'Your voice profile'}</h1>
            {(d.demo_override_used || d.analysis_metadata?.demo?.prepared_data) && (
              <span className="rs-badge" style={{ background: 'var(--warning-tint)', color: 'var(--warning)' }} title={d.analysis_metadata?.demo?.prepared_data ? 'Prepared demo data, not a real recording' : 'Made before day 14 using DEMO_MODE'}>
                Demo
              </span>
            )}
          </div>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            {d.completed_at ? `From your ${re ? 'check-in' : 'baseline'} recording on ${formatDate(d.completed_at, tz)}.` : 'Analysis in progress.'}
          </p>
        </div>
        <div className="rs-grid4">
          {METRICS.map((s) => (
            <MetricTile key={s.key} spec={s} all={m} comparison={re ? d.comparison : null} interpretation={d.interpretation?.[s.key]} />
          ))}
        </div>
        {re && d.comparison && (
          <div className="rs-banner rs-banner--info">
            <span>{d.comparison.summary}</span>
          </div>
        )}
        <div className="rs-cols">
          <div className="rs-card rs-stack" style={{ gap: 10, padding: 24 }}>
            <h2 className="rs-h" style={{ fontSize: 20 }}>What we noticed</h2>
            {d.report?.summary && <p style={{ margin: 0 }}>{d.report.summary}</p>}
            {d.report?.observations.map((o, i) => (
              <p key={i} style={{ margin: 0 }}>{o.text}</p>
            ))}
            <p style={{ margin: 0, fontSize: 15, color: 'var(--muted)' }}>
              These are observations from your recordings, not a diagnosis.
            </p>
          </div>
          <div className="rs-stack" style={{ gap: 10 }}>
            <h2 className="rs-h" style={{ fontSize: 20 }}>
              {(d.report?.priorities.length ?? 0) > 1 ? 'Two things to practice' : 'What to practice'}
            </h2>
            {d.report?.priorities.slice(0, 2).map((p, i) => (
              <div key={p.tag + i} className="rs-opt" style={{ boxShadow: 'none' }}>
                <span className="rs-opt__icon" style={{ background: 'var(--sun)' }}>{i + 1}</span>
                <span>
                  <span className="rs-opt__title">{label(p.tag)}</span>
                  <span className="rs-opt__meta">{[p.reason, ...p.exercise_ids.map(title).filter(Boolean)].join(' · ')}</span>
                </span>
              </div>
            ))}
            <Link className="rs-btn rs-btn--wide" to="/today" style={{ alignSelf: 'flex-start', marginTop: 8 }}>
              {me.data?.capabilities.daily_training === false ? 'See my 14-session plan' : re ? 'See my new plan' : 'Start day 1'}
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
