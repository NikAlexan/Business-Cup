import type { Lesson } from '../api/types'
import { Check } from './Icons'
import { formatEstimate } from '../lib/format'

const STUB = 12 // % height of a session with no practice yet; today's bar gets twice that to fit its number

const minutes = formatEstimate

// Bar height = minutes actually practiced in that session, scaled to the longest session or the planned length.
export function PlanWave({ lessons, todayId, height = 150 }: { lessons: Lesson[]; todayId?: string; height?: number }) {
  const done = lessons.filter((l) => l.status === 'completed').length
  const scale = Math.max(1, ...lessons.map((l) => Math.max(l.practice_seconds ?? 0, l.estimated_duration_seconds)))
  const total = lessons.reduce((s, l) => s + (l.practice_seconds ?? 0), 0)
  return (
    <div className="rs-eq" style={{ height }} role="img" aria-label={`${done} of ${lessons.length} sessions done, ${minutes(total)} practiced, check-in after session ${lessons.length}`}>
      {lessons.map((l) => {
        const s = l.practice_seconds ?? 0
        const today = l.id === todayId && l.status !== 'completed'
        return (
          <i
            key={l.id}
            className={today ? 't' : l.status === 'completed' ? 'd' : ''}
            style={{ height: Math.max(today ? 2 * STUB : STUB, (s / scale) * 100) + '%' }}
            title={`Session ${l.day_index}: ${s ? minutes(s) + ' practiced' : 'not started'}`}
          >
            {l.day_index}
          </i>
        )
      })}
      <i className="c" style={{ height: '100%' }} aria-label="check-in">
        <Check />
      </i>
    </div>
  )
}
