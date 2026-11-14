import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, request } from '../api/api'
import { useMutation } from '@tanstack/react-query'
import { useToday } from '../api/hooks'
import type { Completion } from '../api/types'
import { useRedirectOn401 } from '../components/AppShell'
import { RewardChips } from '../components/RewardChips'
import { ErrorBanner, Skeleton } from '../components/ui'
import { formatDate } from '../lib/format'

const SHAPE = [30, 45, 38, 60, 52, 72, 58, 80, 64, 88, 70, 94, 76, 100]

export default function Done() {
  const { lessonId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const today = useToday()
  // PUT is idempotent on the server, so a reload simply re-reads the same completion.
  const complete = useMutation({
    mutationFn: () => request<Completion>('/progress/' + lessonId, { method: 'PUT', body: { status: 'completed' } }),
    onSuccess: () => ['me', 'today', 'plan', 'progress'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    onError: (e) => {
      const pending = (e as ApiError).details as { pending_plan_item_ids?: string[] } | undefined
      if (e instanceof ApiError && e.code === 'lesson_incomplete' && pending?.pending_plan_item_ids?.[0])
        navigate('/exercise/' + pending.pending_plan_item_ids[0], { replace: true })
    },
  })
  useRedirectOn401(complete.error)
  useEffect(() => complete.mutate(), [lessonId]) // eslint-disable-line react-hooks/exhaustive-deps

  const c = complete.data
  const tz = today.data?.timezone ?? 'UTC'
  return (
    <div className="rs rs-page" style={{ background: 'var(--stage)', minHeight: '100dvh' }}>
      <div className="rs-wrap" style={{ maxWidth: 760, paddingTop: 'clamp(48px, 18vh, 200px)', paddingBottom: 48, display: 'flex', flexDirection: 'column', gap: 14, color: '#fff' }}>
        {complete.isPending && <Skeleton height={240} />}
        {complete.error && !(complete.error instanceof ApiError && complete.error.code === 'lesson_incomplete') && (
          <>
            <ErrorBanner error={complete.error} onRetry={() => complete.mutate()} />
            <Link className="rs-btn rs-btn--sun" to="/today" style={{ alignSelf: 'flex-start' }}>Back to today</Link>
          </>
        )}
        {c && (
          <>
            <h1 className="rs-h rs-hero-title" style={{ lineHeight: 1.05 }}>Nice session!</h1>
            <p style={{ margin: 0, fontSize: 19, maxWidth: '32ch' }}>
              Session {c.completed_lessons} of {c.total_lessons} is done
              {c.streak.current_days > 1 ? ` — ${c.streak.current_days} days in a row` : ''}.
              {c.next_lesson_available_on ? ` Session ${c.completed_lessons + 1} opens ${formatDate(c.next_lesson_available_on, tz)}.` : ' Your check-in is next.'}
            </p>
            <RewardChips streak={c.streak.current_days} notes={c.session_reward.notes} seconds={c.session_reward.practice_seconds} style={{ marginTop: 8, color: 'var(--ink)' }} />
            <span style={{ fontSize: 15, opacity: 0.8 }}>Notes earned and recorded practice time. Untimed warm-ups are not included.</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90, marginTop: 20 }} aria-hidden="true">
              {SHAPE.map((h, i) => (
                <i key={i} style={{ flex: 1, height: h + '%', borderRadius: 6, background: i < c.completed_lessons ? 'var(--sun)' : 'rgba(255,255,255,.16)' }} />
              ))}
            </div>
            <Link className="rs-btn rs-btn--sun rs-btn--wide" to="/today" style={{ alignSelf: 'flex-start', marginTop: 20 }}>
              Continue
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
