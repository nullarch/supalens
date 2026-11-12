/** Localized recorded time with an explicit zone, independent of the server/browser zone. */
export function contextTimestamp(value: string | null, locale: string) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return { iso: date.toISOString(), label: new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
  }).format(date) + ' UTC' }
}

/** The existing endpoint completes tier 1 inline and only queues tier 2. */
export function generationOutcome(ok: boolean, body: unknown): 'completed' | 'started' | 'limit' | 'quota' | 'running' | 'generic' {
  if (!body || typeof body !== 'object') return 'generic'
  const value = body as Record<string, unknown>
  if (ok) {
    if (value.ok === true && value.tier === 1) return 'completed'
    if (value.ok === true && value.tier === 2 && typeof value.triggerRunId === 'string' && value.triggerRunId.trim()) return 'started'
    return 'generic'
  }
  if (value.error === 'context_limit') return 'limit'
  if (value.error === 'quota_exceeded') return 'quota'
  if (value.error === 'generation_in_progress') return 'running'
  return 'generic'
}
