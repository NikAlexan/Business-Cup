import { useInfiniteQuery } from '@tanstack/react-query'
import { request } from '../api/api'
import { usePlan, useProgress } from '../api/hooks'
import type { Progress as P } from '../api/types'
import { AppShell, useRedirectOn401 } from '../components/AppShell'
import { Check } from '../components/Icons'
import { METRICS, MetricTile } from '../components/MetricTile'
import { RewardChips } from '../components/RewardChips'
import { ErrorBanner, Skeleton } from '../components/ui'
import { formatDate } from '../lib/format'

const clock = (s: number | null) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

function Takes({ tz }: { tz: string }) {
  const plan = usePlan()
  const q = useInfiniteQuery({
    queryKey: ['progress', 'recordings'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => request<P>('/progress?days=1&recordings_limit=10' + (pageParam ? '&recordings_cursor=' + encodeURIComponent(pageParam) : '')),
    getNextPageParam: (p) => p.next_recordings_cursor ?? undefined,
  })
  const titles = new Map(plan.data?.lessons.flatMap((l) => l.items.map((i) => [i.id, `${i.exercise_id} · ${i.title}`] as const)) ?? [])
  const recs = q.data?.pages.flatMap((p) => p.recordings).filter((r) => r.status === 'completed') ?? []
  return (
    <div className="rs-stack" style={{ gap: 10 }}>
      <h2 className="rs-h" style={{ fontSize: 20 }}>Recent takes</h2>
      {q.isPending && <Skeleton height={160} />}
      {q.error && <ErrorBanner error={q.error} onRetry={() => q.refetch()} />}
      {q.data && !recs.length && <p className="rs-label" style={{ margin: 0 }}>No takes yet.</p>}
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
          <audio controls preload="none" src={r.audio_url} style={{ width: '100%', maxWidth: 280, height: 36 }} aria-label="Play take" />
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
  if (p.isPending) return <AppShell><Skeleton height={360} /></AppShell>
  if (p.error || !p.data) return <AppShell><ErrorBanner error={p.error} onRetry={() => p.refetch()} /></AppShell>
  const d = p.data
  const s = d.summary
  const last = d.measurement_history.at(-1)
  const week = d.activity.slice(-7)
  return (
    <AppShell>
      <div className="rs-stack" style={{ gap: 20 }}>
        <h1 className="rs-h rs-h1">Progress</h1>
        <RewardChips streak={s.current_streak_days} notes={s.notes_total} seconds={s.practice_seconds_total} />
        <div className="rs-grid4">
          <div className="rs-metric"><span className="rs-label">Sessions</span><span className="rs-metric__v">{s.current_plan_completed_lessons}<small>/ {s.current_plan_total_lessons}</small></span><span className="rs-metric__n">{s.completed_lessons_all_time} all time</span></div>
          <div className="rs-metric"><span className="rs-label">Streak</span><span className="rs-metric__v">{s.current_streak_days}<small>days</small></span><span className="rs-metric__n">Longest {s.longest_streak_days}</span></div>
          <div className="rs-metric"><span className="rs-label">Notes</span><span className="rs-metric__v">{s.notes_total}</span><span className="rs-metric__n">For finished practice</span></div>
          <div className="rs-metric"><span className="rs-label">Recorded practice</span><span className="rs-metric__v">{Math.floor(s.practice_seconds_total / 60)}<small>min</small></span><span className="rs-metric__n">{s.last_practice_on ? 'Last ' + formatDate(s.last_practice_on, d.timezone) : 'No sessions yet'}</span></div>
        </div>
        <div className="rs-cols">
          <div className="rs-stack" style={{ gap: 16 }}>
            <div className="rs-card rs-stack" style={{ gap: 14, padding: 24 }}>
              <h2 className="rs-h" style={{ fontSize: 20 }}>Last 7 days</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, textAlign: 'center' }}>
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
                  <h2 className="rs-h" style={{ fontSize: 20 }}>Latest measurements</h2>
                  <span className="rs-label">{formatDate(last.completed_at, d.timezone)}</span>
                </div>
                <div className="rs-grid4" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
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
