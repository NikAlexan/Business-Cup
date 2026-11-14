import type { Lesson } from '../api/types'
import { Check } from './Icons'

// Decorative rising shape from the mockup; colour carries the data (done / today / ahead).
const SHAPE = [30, 45, 38, 60, 52, 72, 58, 80, 64, 88, 70, 94, 76, 100]

export function PlanWave({ lessons, todayId, height = 150 }: { lessons: Lesson[]; todayId?: string; height?: number }) {
  const done = lessons.filter((l) => l.status === 'completed').length
  return (
    <div className="rs-eq" style={{ height }} role="img" aria-label={`${done} of ${lessons.length} sessions done, check-in after session ${lessons.length}`}>
      {lessons.map((l, i) => (
        <i key={l.id} className={l.id === todayId && l.status !== 'completed' ? 't' : l.status === 'completed' ? 'd' : ''} style={{ height: SHAPE[i % 14] + '%' }}>
          {l.day_index}
        </i>
      ))}
      <i className="c" style={{ height: '100%' }} aria-label="check-in">
        <Check />
      </i>
    </div>
  )
}
