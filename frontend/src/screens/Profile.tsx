import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
  const navigate = useNavigate()
  useEffect(() => {
    const data = a.data
    if (!data || a.isFetching || data.status === 'completed') return
    navigate(data.job_id && ['queued', 'processing', 'failed'].includes(data.status)
      ? `/analyzing?assessment_id=${data.id}&job_id=${data.job_id}`
      : '/record?assessment_id=' + data.id, { replace: true })
  }, [a.data, a.isFetching, navigate])
  const me = useMe()
  const ex = useExercises()
  const title = (id: string) => ex.data?.items.find((x) => x.id === id)?.title
  const tz = me.data?.preferences.timezone ?? 'UTC'
  if (a.isPending) return <AppShell><Skeleton height={360} /></AppShell>
  if (a.error || !a.data) return <AppShell><ErrorBanner error={a.error} onRetry={() => a.refetch()} /></AppShell>
  if (a.data.status !== 'completed') return <AppShell><Skeleton height={360} /></AppShell>
  const d = a.data
  const re = d.kind === 'reassessment'
  const m = d.measurements ?? {}
  const taskTitle = (kind: string) => ({ control_text: 'Control passage', novel_text: 'Unfamiliar passage', intonation: 'Expression task' }[kind] ?? kind.replace(/_/g, ' '))
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
            <div className="rs-stack" style={{ gap: 6 }}><span>{d.comparison.summary}</span>{d.comparison.limitations?.map((note, index) => <span key={index}>{note}</span>)}</div>
          </div>
        )}
        {re && d.comparison && <section className="rs-card rs-stack" aria-label="Before and after recordings" style={{ padding: 24, gap: 16 }}>
          <h2 className="rs-h" style={{ fontSize: 22 }}>Listen before and after</h2>
          {!d.comparison.audio_pairs?.length && <p>Matching recordings are not available for this check-in.</p>}
          {d.comparison.audio_pairs?.map((pair) => <div key={pair.kind} className="rs-stack" style={{ gap: 8 }}>
            <h3 className="rs-h" style={{ fontSize: 18 }}>{taskTitle(pair.kind)}</h3>
            {pair.kind === 'novel_text' && <p className="rs-label">These unfamiliar passages use different texts; compare the delivery rather than matching individual words.</p>}
            <label className="rs-stack" style={{ gap: 6 }}>Before<audio controls preload="metadata" aria-label={'Before: ' + pair.kind} src={pair.before_audio_url} style={{ width: '100%' }} /></label>
            <label className="rs-stack" style={{ gap: 6 }}>After<audio controls preload="metadata" aria-label={'After: ' + pair.kind} src={pair.after_audio_url} style={{ width: '100%' }} /></label>
          </div>)}
        </section>}
        {!d.comparison?.audio_pairs?.length && (d.tasks ?? []).some((task) => task.recording_id) && <section className="rs-card rs-stack" aria-label="Assessment recordings" style={{ padding: 24, gap: 16 }}>
          <h2 className="rs-h" style={{ fontSize: 22 }}>Listen to your assessment recordings</h2>
          {(d.tasks ?? []).filter((task) => task.recording_id).map((task) => <div className="rs-stack" key={task.id} style={{ gap: 8 }}>
            <h3 className="rs-h" style={{ fontSize: 18 }}>{taskTitle(task.kind)}</h3>
            <audio controls preload="none" aria-label={taskTitle(task.kind) + ' recording'} src={'/api/v1/recordings/' + task.recording_id + '/audio'} style={{ width: '100%' }} />
            <details><summary>Read the recorded script</summary><p>{task.text}</p></details>
          </div>)}
        </section>}
        {d.measurement_scope && <details className="rs-card" style={{ padding: 20 }}>
          <summary>Which recordings were measured?</summary>
          <dl>{([
            ['Pace and pauses', d.measurement_scope.pace_and_pauses_task_ids],
            ['Pitch', d.measurement_scope.pitch_task_ids],
            ['Intonation range', d.measurement_scope.intonation_task_ids],
          ] as [string, string[]][]).map(([name, ids]) => <div key={name}><dt style={{ fontWeight: 600 }}>{name}</dt><dd>{ids.map((id) => taskTitle(d.tasks?.find((task) => task.id === id)?.kind ?? 'Earlier protocol task')).join(' · ')}</dd></div>)}</dl>
        </details>}
        <div className="rs-cols">
          <div className="rs-card rs-stack" style={{ gap: 10, padding: 24 }}>
            <h2 className="rs-h" style={{ fontSize: 20 }}>What we noticed</h2>
            {d.report?.summary && <p style={{ margin: 0 }}>{d.report.summary}</p>}
            {d.report?.observations.map((o, i) => (
              <p key={i} style={{ margin: 0 }}>{o.text}</p>
            ))}
            <p style={{ margin: 0, fontSize: 15, color: 'var(--muted)' }}>
              AI listening observations can be mistaken. Check them against your recordings; they are not a diagnosis.
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
              {me.data?.capabilities?.daily_training === false ? 'See my 14-session plan' : re ? 'See my new plan' : 'Start day 1'}
            </Link>
          </div>
        </div>
        {!!d.report?.limitations?.length && <section className="rs-card rs-stack" aria-label="Analysis limitations" style={{ padding: 24, gap: 10 }}>
          <h2 className="rs-h" style={{ fontSize: 20 }}>Keep in mind</h2>
          <ul style={{ margin: 0, paddingLeft: 22 }}>{d.report.limitations.map((note, index) => <li key={index}>{note}</li>)}</ul>
        </section>}
      </div>
    </AppShell>
  )
}
