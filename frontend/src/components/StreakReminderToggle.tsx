import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMe } from '../api/hooks'
import { disablePush, enablePush, pushSupported, sendTestPush } from '../lib/push'
import { ErrorBanner } from './ui'

export function StreakReminderToggle({ style }: { style?: React.CSSProperties }) {
  const me = useMe()
  const qc = useQueryClient()
  const key = me.data?.push_public_key
  const on = !!me.data?.push_enabled
  const toggle = useMutation({
    mutationFn: () => (on ? disablePush() : enablePush(key!)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
  const test = useMutation({ mutationFn: sendTestPush, onError: () => qc.invalidateQueries({ queryKey: ['me'] }) })
  if (!pushSupported() || !key) return null
  const denied = toggle.error instanceof Error && toggle.error.message === 'permission_denied'
  return (
    <div className="rs-stack" style={{ gap: 8, ...style }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button className="rs-btn rs-btn--quiet" type="button" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
          {on ? 'Streak reminders on · Turn off' : 'Remind me to keep my streak'}
        </button>
        {on && (
          <button className="rs-btn rs-btn--quiet" type="button" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isSuccess ? 'Test reminder sent' : 'Send test reminder'}
          </button>
        )}
      </div>
      {denied && <span style={{ fontSize: 15 }}>Notifications are blocked in browser settings.</span>}
      {toggle.error && !denied && <ErrorBanner error={toggle.error} />}
      {test.error && <ErrorBanner error={test.error} />}
    </div>
  )
}
