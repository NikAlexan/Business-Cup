export const formatMinutes = (seconds: number) => `${Math.floor(seconds / 60)} min`

export const formatDate = (iso: string, timezone: string) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: iso.length === 10 ? 'UTC' : timezone,
  })

export const formatEstimate = (seconds: number) => seconds < 60
  ? `${Math.round(seconds)} sec`
  : `${Math.round(seconds / 60 * 2) / 2} min`
