import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePlan, useProgress, useToday } from '../api/hooks'
import type { PlanItem } from '../api/types'
import { AppShell, Chips, useRedirectOn401 } from '../components/AppShell'
import { Check } from '../components/Icons'
import { PlanWave } from '../components/PlanWave'
import { ErrorBanner, Skeleton } from '../components/ui'
import { formatDate, formatEstimate } from '../lib/format'

const VERIFY: Record<string, string> = { timer: 'timer', self_confirmation: 'self-check', recording: 'recording' }
const mins = formatEstimate

export function ItemRow({ item }: { item: PlanItem }) {
  const done = item.status === 'completed'
  return (
    <Link className="rs-opt" to={'/exercise/' + item.id} aria-label={`${item.title}${done ? ', done' : ''}`}>
      <span className="rs-opt__icon" style={done ? { background: 'var(--success-tint)', color: 'var(--success)' } : undefined}>
        {done ? <Check /> : item.position}
      </span>
      <span>
        <span className="rs-opt__title">{item.title}</span>
        <span className="rs-opt__meta">
          About {mins(item.estimated_duration_seconds)} · {VERIFY[item.task.verification.type]} · {done ? 'done' : `+${item.notes_available} notes`}
        </span>
      </span>
    </Link>
  )
}

function Week() {
  const p = useProgress()
  if (!p.data) return null
  const days = p.data.activity.slice(-7)
  return (
    <div className="rs-card rs-stack d-only" style={{ gap: 14, padding: 24 }}>
      <h2 className="rs-h" style={{ fontSize: 19 }}>This week</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, textAlign: 'center' }}>
        {days.map((d) => (
          <div key={d.date} className="rs-stack" style={{ gap: 4, alignItems: 'center' }}>
            <span className="rs-label">{new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })}</span>
            <span style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', background: d.completed_lessons ? 'var(--sun)' : 'var(--line)' }}>
              {d.completed_lessons ? <Check /> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const today = useToday()
  const plan = usePlan()
  const navigate = useNavigate()
  useRedirectOn401(today.error)
  const t = today.data
  useEffect(() => {
    if (t?.daily_status === 'needs_assessment') navigate('/', { replace: true })
  }, [t?.daily_status, navigate])

  if (today.isPending) return <AppShell><Skeleton height={360} /></AppShell>
  if (today.error || !t) return <AppShell><ErrorBanner error={today.error} onRetry={() => today.refetch()} /></AppShell>

  const lesson = t.lesson
  const next = lesson?.items.find((i) => i.status !== 'completed')
  const checkIn = t.reassessment.next_available_on
  const total = plan.data?.total_lessons ?? 14
  const open = t.daily_status === 'available' || t.daily_status === 'in_progress'

  return (
    <AppShell>
      <div className="m-only" style={{ marginBottom: 16 }}>
        <Chips />
      </div>
      <div className="rs-cols rs-cols--side">
        <div className="rs-stack" style={{ gap: 24 }}>
          <div className="rs-card rs-stack" style={{ gap: 16, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <h1 className="rs-h" style={{ fontSize: 26 }}>
                {t.daily_status === 'plan_completed' ? 'Plan complete' : t.daily_status === 'completed' ? 'Done for today' : lesson?.items[0] ? 'Your plan' : 'Today'}
              </h1>
              {lesson && <span className="rs-label">Session {lesson.day_index} of {total}</span>}
            </div>
            {plan.data ? <PlanWave lessons={plan.data.lessons} todayId={open ? lesson?.id : undefined} /> : <Skeleton height={150} />}
            {checkIn && <span className="rs-label">Check-in on {formatDate(checkIn, t.timezone)} · 14 days after your baseline</span>}
          </div>

          {open && lesson && (
            <div className="rs-stack" style={{ gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <h2 className="rs-h" style={{ fontSize: 22 }}>Today's session</h2>
                <span className="rs-label">About {mins(lesson.estimated_duration_seconds)}</span>
              </div>
              {lesson.items.map((i) => (
                <ItemRow key={i.id} item={i} />
              ))}
              {next ? (
                <Link className="rs-btn rs-btn--wide" to={'/exercise/' + next.id} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                  {t.daily_status === 'in_progress' ? 'Continue' : 'Start'} session {lesson.day_index}
                </Link>
              ) : (
                <Link className="rs-btn rs-btn--wide" to={'/done/' + lesson.id} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                  Finish session {lesson.day_index}
                </Link>
              )}
            </div>
          )}
          {t.daily_status === 'completed' && (
            <div className="rs-banner rs-banner--info" role="status">
              <span>
                Today's session is done.{' '}
                {t.next_lesson_available_on ? `Next lesson opens ${formatDate(t.next_lesson_available_on, t.timezone)}.` : ''}
              </span>
            </div>
          )}
          {t.daily_status === 'plan_completed' && (
            <div className="rs-stack" style={{ gap: 12, alignItems: 'flex-start' }}>
              <p style={{ margin: 0 }}>All 14 sessions are done. Record the same three tasks to compare with your baseline.</p>
              <Link className="rs-btn rs-btn--wide" to="/check-in">Go to check-in</Link>
            </div>
          )}
        </div>
        <aside className="rs-stack" style={{ gap: 16 }}>
          <Week />
          {checkIn && (
            <div className="rs-card rs-stack" style={{ gap: 8, padding: 24, background: 'var(--sky-tint)' }}>
              <h2 className="rs-h" style={{ fontSize: 22 }}>Check-in on {formatDate(checkIn, t.timezone)}</h2>
              <p style={{ margin: 0, fontSize: 15 }}>Same 3 tasks as your baseline. Then a new plan.</p>
              {(t.reassessment.available || t.reassessment.demo_override_available) && (
                <Link className="rs-link" to="/check-in" style={{ fontSize: 15 }}>Open check-in</Link>
              )}
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  )
}
