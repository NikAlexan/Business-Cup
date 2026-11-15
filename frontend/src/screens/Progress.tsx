import { AudioPlayer } from '../components/AudioPlayer'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { request } from '../api/api'
import { usePlan, useProgress } from '../api/hooks'
import type { Progress as P } from '../api/types'
import { AppShell, useRedirectOn401 } from '../components/AppShell'
import { Check, ClockIcon, NoteIcon, StreakIcon } from '../components/Icons'
import { StreakReminderToggle } from '../components/StreakReminderToggle'
import { METRICS, MetricTile } from '../components/MetricTile'
import { ErrorBanner, Skeleton } from '../components/ui'
import { formatDate, formatMinutes } from '../lib/format'

const clock = (s: number | null) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

function Takes({ tz }: { tz: string }) {
  const plan = usePlan()
  const q = useInfiniteQuery({
    queryKey: ['progress', 'recordings'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => request<P>('/progress?days=1&recordings_limit=10' + (pageParam ? '&recordings_cursor=' + encodeURIComponent(pageParam) : '')),
    getNextPageParam: (p) => p.next_recordings_cursor ?? undefined,
  })
  const titles = new Map(plan.data?.lessons.flatMap((l) => l.items.map((i) => [i.id, i.title] as const)) ?? [])
  const recs = q.data?.pages.flatMap((p) => p.recordings).filter((r) => r.status === 'completed') ?? []
  // No takes: drop the column so the left side gets the full width.
  if (q.data && !recs.length) return null
  return (
    <div className="rs-stack rs-gap-3">
      <h2 className="rs-h rs-h3">Recent takes</h2>
      {q.isPending && <Skeleton height={160} />}
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {recs.map((r) => (
        <div key={r.id} className="rs-opt" style={{ boxShadow: 'none', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 180 }}>
            <span className="rs-opt__title" style={{ fontSize: 16 }}>
              {r.purpose === 'assessment' ? 'Voice profile task' : titles.get(r.plan_item_id ?? '') ?? 'Exercise take'}
            </span>
            <span className="rs-opt__meta">
              {formatDate(r.created_at, tz)} · {clock(r.duration_seconds)}
            </span>
          </span>
          {r.plan_item_id && <Link className="rs-link" to={'/exercise/' + r.plan_item_id}>Feedback and practice again</Link>}
          <div style={{ flexBasis: '100%' }}><AudioPlayer preload="none" src={r.audio_url} aria-label="Take" /></div>
        </div>
      ))}
      {q.hasNextPage && (
        <button className="rs-btn rs-btn--secondary" type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} style={{ alignSelf: 'flex-start' }}>
          Load more
        </button>
      )}
    </div>
  )
}

export default function Progress() {
  const p = useProgress()
  useRedirectOn401(p.error)
  if (p.isPending) return <AppShell chips={false}><Skeleton height={360} /></AppShell>
  if (p.error || !p.data) return <AppShell chips={false}><ErrorBanner error={p.error} onRetry={() => p.refetch()} /></AppShell>
  const d = p.data
  const s = d.summary
  const last = d.measurement_history.at(-1)
  const week = d.activity.slice(-7)
  return (
    // The tiles below carry these numbers with context; header chips would repeat them.
    <AppShell chips={false}>
      <div className="rs-stack rs-gap-5">
        <h1 className="rs-h rs-h1">Progress</h1>
        {/* One summary row, as in the mockup; the header chips are hidden on this screen so nothing repeats. */}
        <div className="rs-chips" style={{ marginTop: -12 }}>
          <span className="rs-chip"><StreakIcon /> {s.current_streak_days}-day streak · longest {s.longest_streak_days}</span>
          <span className="rs-chip"><NoteIcon /> {s.notes_total} notes</span>
          <span className="rs-chip"><ClockIcon /> {formatMinutes(s.practice_seconds_total)} recorded{s.last_practice_on ? ' · last ' + formatDate(s.last_practice_on, d.timezone) : ''}</span>
          <span className="rs-chip">{s.current_plan_completed_lessons} of {s.current_plan_total_lessons} sessions · {s.completed_lessons_all_time} all time</span>
        </div>
        <StreakReminderToggle />
        <div className="rs-cols">
          <div className="rs-stack rs-gap-4">
            <div className="rs-card rs-stack" style={{ gap: 14, padding: 24 }}>
              <h2 className="rs-h rs-h3">Last 7 days</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, textAlign: 'center', maxWidth: 420 }}>
                {week.map((w) => (
                  <div key={w.date} className="rs-stack" style={{ gap: 4, alignItems: 'center' }}>
                    <span className="rs-label">{new Date(w.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })}</span>
                    <span style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', background: w.completed_lessons ? 'var(--sun)' : 'var(--line)' }} aria-label={w.completed_lessons ? 'practiced' : 'no practice'}>
                      {w.completed_lessons ? <Check /> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {last && (
              <div className="rs-card rs-stack" style={{ gap: 12, padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <h2 className="rs-h rs-h3">Latest measurements</h2>
                  <span className="rs-label">{formatDate(last.completed_at, d.timezone)}</span>
                </div>
                <div className="rs-grid4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                  {METRICS.map((m) => <MetricTile key={m.key} spec={m} all={last.measurements} />)}
                </div>
                <span className="rs-label">Daily takes are light checks. The full comparison comes at check-in.</span>
              </div>
            )}
          </div>
          <Takes tz={d.timezone} />
        </div>
      </div>
    </AppShell>
  )
}
