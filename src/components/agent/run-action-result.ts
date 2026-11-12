type Acknowledgement = 'confirmed' | 'rejected' | 'unknown'

export function runActionAcknowledgement(value: unknown): Acknowledgement {
  if (!value || typeof value !== 'object') return 'unknown'
  const ok = (value as Record<string, unknown>).ok
  return ok === true ? 'confirmed' : ok === false ? 'rejected' : 'unknown'
}

/** Accept the server's public-share URL shape without choosing a deployment host. */
export function shareCreationResult(value: unknown): { kind: Acknowledgement; url?: string } {
  const kind = runActionAcknowledgement(value)
  if (kind !== 'confirmed') return { kind }
  const url = (value as Record<string, unknown>).url
  if (typeof url !== 'string' || url.trim() !== url) return { kind: 'unknown' }
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash ||
      !/^\/share\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) return { kind: 'unknown' }
    return { kind: 'confirmed', url }
  } catch { return { kind: 'unknown' } }
}

export type StopResult = 'requested' | 'terminal' | 'rejected' | 'unknown'

/** Only the endpoint's explicit pre-write rejection shapes permit a normal retry. */
export function stopActionResult(status: number, value: unknown): StopResult {
  if (!value || typeof value !== 'object') return 'unknown'
  const result = value as Record<string, unknown>
  if ((status === 401 && result.error === 'unauthorized') || (status === 404 && result.error === 'not_found') ||
    (status === 500 && result.error === 'supabase_not_configured')) return 'rejected'
  if (status < 200 || status >= 300 || result.ok !== true) return 'unknown'
  if (result.status === 'cancelled') return 'requested'
  if (result.status === 'succeeded' || result.status === 'failed') return 'terminal'
  return 'unknown'
}
