import { ApiError } from '../api/api'

export function ErrorBanner({ error, onRetry, text }: { error?: unknown; onRetry?: () => void; text?: string }) {
  const message =
    text ??
    (
    error instanceof ApiError
      ? error.message
      : error instanceof TypeError
        ? 'No connection. Check your network and try again.'
        : 'Something went wrong.')
  return (
    <div className="rs-banner rs-banner--danger" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="rs-btn rs-btn--quiet" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export const Skeleton = ({ height = 120 }: { height?: number }) => (
  <div className="rs-skeleton" style={{ height }} aria-busy="true" aria-label="Loading" />
)
