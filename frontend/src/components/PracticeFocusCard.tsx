import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { request } from '../api/api'
import { usePracticeFocus } from '../api/hooks'
import { OUTCOMES } from './StoryFocus'
import { ErrorBanner } from './ui'

export function PracticeFocusCard({ storyId }: { storyId?: string }) {
  const data = usePracticeFocus()
  const qc = useQueryClient()
  const clear = useMutation({ mutationFn: (id: string) => request('/practice-focus/' + id, { method: 'DELETE' }), onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['practice-focus'] }); void qc.invalidateQueries({ queryKey: ['plan-item'] })
  } })
  const focus = data.data?.focus
  if (data.error) return <ErrorBanner error={data.error} onRetry={() => data.refetch()} />
  if (!focus) return null
  return <section className="rs-card rs-stack" aria-label="Your practice focus" style={{ padding: 24, gap: 12 }}>
    <h2 className="rs-h" style={{ fontSize: 22 }}>{focus.intent === 'keep' ? 'Keep what worked' : focus.intent === 'experiment' ? 'Keep working on one change' : 'Your saved practice focus'}</h2>
    <p style={{ margin: 0 }}><strong>{focus.skill_label}:</strong> {focus.note}</p>
    <p style={{ margin: 0 }}>{focus.listening_question}</p>
    <span className="rs-label">Saved for story practice and your next session.</span>
    {data.data?.last_check && <span className="rs-label">Last story: you marked “{OUTCOMES.find(([key]) => key === data.data?.last_check?.outcome)?.[1]}”.</span>}
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      {storyId && <Link className="rs-btn rs-btn--secondary" to={'/exercise/' + storyId}>Open story practice</Link>}
      <button className="rs-link" type="button" disabled={clear.isPending} onClick={() => clear.mutate(focus.id)}>Clear this focus</button>
    </div>
    {clear.error && <ErrorBanner error={clear.error} onRetry={() => clear.mutate(focus.id)} />}
  </section>
}
