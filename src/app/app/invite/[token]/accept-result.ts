export type AcceptResult =
  | { kind: 'accepted'; orgId: string }
  | { kind: 'rejected'; reason: 'error' | 'unconfigured' | 'unauthorized' | 'not_found' }
  | { kind: 'unconfirmed' }

/** Transport completion alone is not an invitation acknowledgement. Never echo
 * arbitrary server text (the legacy action can return an unmapped RPC message).
 */
export function acceptanceResult(value: unknown): AcceptResult {
  if (!value || typeof value !== 'object') return { kind: 'unconfirmed' }
  const result = value as Record<string, unknown>
  if (result.ok === true && result.data && typeof result.data === 'object') {
    const orgId = (result.data as Record<string, unknown>).orgId
    if (typeof orgId === 'string' && orgId.trim()) return { kind: 'accepted', orgId }
  }
  if (result.ok === false && typeof result.reason === 'string' && ['error', 'unconfigured', 'unauthorized', 'not_found'].includes(result.reason)) {
    return { kind: 'rejected', reason: result.reason as 'error' | 'unconfigured' | 'unauthorized' | 'not_found' }
  }
  return { kind: 'unconfirmed' }
}
