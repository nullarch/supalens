export type DangerTarget = 'org' | 'account'
export type DangerKnownMessages = { notOwner?: string; subscription?: string; otherMembers?: string; teardown?: string; finalStep?: string }

/** Only explicit preflight rejection establishes that destructive work did not start. */
export function dangerResult(value: unknown, known: DangerKnownMessages) {
  if (!value || typeof value !== 'object') return { kind: 'unknown' as const }
  const result = value as Record<string, unknown>
  if (result.ok === true) return { kind: 'confirmed' as const }
  if (result.ok !== false) return { kind: 'unknown' as const }
  if (result.reason === 'unconfigured' || result.reason === 'unauthorized') return { kind: 'blocked' as const, reason: result.reason }
  const message = typeof result.message === 'string' && result.message ? result.message : null
  if (!message) return { kind: 'unknown' as const }
  if (message === known.notOwner) return { kind: 'blocked' as const, reason: 'notOwner' as const }
  if (message === known.subscription) return { kind: 'blocked' as const, reason: 'subscription' as const }
  if (message === known.otherMembers) return { kind: 'blocked' as const, reason: 'otherMembers' as const }
  if (message === known.teardown) return { kind: 'partial' as const, stage: 'teardown' as const }
  if (message === known.finalStep) return { kind: 'partial' as const, stage: 'finalStep' as const }
  return { kind: 'unknown' as const }
}
