import { isRecoveryId, recoveryReturn } from '@/lib/alerts/recovery'

export function oauthReturnContext(params: Pick<URLSearchParams, 'get'>) {
  const recovery = recoveryReturn(params.get('recovery'))
  const connectionId = params.get('supabaseConnection')
  if (!recovery && !isRecoveryId(connectionId)) return null
  return {
    recovery,
    connectionId: isRecoveryId(connectionId) ? connectionId : null,
    selecting: params.get('select') === 'supabase',
    importing: params.get('connecting') === 'supabase',
    planLimited: /^\d+$/.test(params.get('skipped') ?? '') && Number(params.get('skipped')) > 0,
  }
}

export type OAuthSnapshot = { status: string; activeSources: number }
export function parseOAuthSnapshot(value: unknown): OAuthSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (!['active', 'pending', 'error', 'revoked', 'expired', 'disabled'].includes(String(row.status))
    || typeof row.activeSources !== 'number' || !Number.isSafeInteger(row.activeSources) || row.activeSources < 0) return null
  return { status: row.status as string, activeSources: row.activeSources }
}

export function oauthFeedbackPhase(context: NonNullable<ReturnType<typeof oauthReturnContext>>, snapshot: OAuthSnapshot | null) {
  if (!snapshot) return 'unconfirmed' as const
  if (snapshot.status === 'pending') return 'pending' as const
  if (snapshot.status !== 'active') return 'unavailable' as const
  if (context.recovery === 'authorized') return 'authorized' as const
  if (context.selecting) return 'select' as const
  if (context.importing && snapshot.activeSources === 0) return 'importing' as const
  return snapshot.activeSources > 0 ? 'connected' as const : 'select' as const
}
