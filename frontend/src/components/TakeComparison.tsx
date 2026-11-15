import { useAttempt } from '../api/hooks'
import type { Attempt } from '../api/types'
import { ErrorBanner } from './ui'

export function TakeComparison({ take }: { take: Attempt }) {
  const previous = useAttempt(take.practice_focus?.attempt_id)
  if (!take.practice_focus) return null
  const before = previous.data
  const currentIntent = (take.training_focus ?? take.practice_focus)?.intent
  const sameTiming = before?.feedback.version === 'speech-timing-feedback-v1' && take.feedback.version === before.feedback.version
  const rows = sameTiming ? [
    { key: 'speaking_rate_wpm', label: 'Pace', format: (n: number) => Math.round(n) + ' words/min' },
    { key: 'pause_ratio', label: 'Pauses in timed speech', format: (n: number) => Math.round(n * 100) + '%' },
  ].flatMap((row) => {
    const first = before?.feedback.metrics?.[row.key]
    const latest = take.feedback.metrics?.[row.key]
    return first?.available && latest?.available && typeof first.value === 'number' && typeof latest.value === 'number'
      ? [{ ...row, first: row.format(first.value), latest: row.format(latest.value) }] : []
  }) : []
  return <section className="rs-stack" aria-label="Compare with your previous take" style={{ gap: 10 }}>
    <h3 className="rs-h" style={{ fontSize: 20 }}>Compare with your previous take</h3>
    {previous.isPending && <p>Loading the previous take…</p>}
    {previous.error && <ErrorBanner error={previous.error} onRetry={() => previous.refetch()} />}
    {before?.recording_id && <>
      <span className="rs-label">Previous take · use the player above for this take</span>
      <audio controls preload="metadata" aria-label="Previous take for comparison" src={'/api/v1/recordings/' + before.recording_id + '/audio'} style={{ width: '100%' }} />
    </>}
    {currentIntent === 'keep' && <p className="rs-label">You chose to keep a useful feature for this take.</p>}
    {currentIntent === 'undecided' && <p className="rs-label">You chose to listen again before deciding on a change.</p>}
    {before?.training_focus && <p className="rs-label">Previous story focus: {before.training_focus.note}</p>}
    {before && before.training_focus?.id !== take.training_focus?.id && <p className="rs-label">Your chosen focus changed between these takes. Keep that change in mind when listening.</p>}
    {rows.length > 0 && <table style={{ width: '100%', textAlign: 'left' }}>
      <caption className="rs-label">Timing for the same exercise; a change is not automatically an improvement.</caption>
      <thead><tr><th scope="col">Measurement</th><th scope="col">Previous</th><th scope="col">This take</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{row.first}</td><td>{row.latest}</td></tr>)}</tbody>
    </table>}
    {before && <p style={{ margin: 0 }}>Listen to both takes with your chosen focus in mind. Which delivery supports the meaning?</p>}
  </section>
}
