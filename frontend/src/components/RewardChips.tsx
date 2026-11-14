import { formatMinutes } from '../lib/format'
import { ClockIcon, NoteIcon, StreakIcon } from './Icons'

export function RewardChips({ streak, notes, seconds, style, className }: { streak?: number; notes: number; seconds?: number; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={className ? 'rs-chips ' + className : 'rs-chips'} style={style}>
      {streak !== undefined && (
        <span className="rs-chip" title="Days in a row">
          <StreakIcon /> {streak}
          <span className="d-only">&nbsp;{streak === 1 ? 'day' : 'days'}</span>
        </span>
      )}
      <span className="rs-chip" title="Notes earned">
        <NoteIcon /> {notes}
      </span>
      {seconds !== undefined && (
        <span className="rs-chip" title="Recorded or reported time; untimed warm-ups are not included">
          <ClockIcon /> {formatMinutes(seconds)}
        </span>
      )}
    </div>
  )
}
