import { parseAnalysisStart } from '@/components/agent/analysis-start'

export function integrationStatus(status: string) {
  switch (status) {
    case 'active': return { label: 'active' as const, intent: 'positive' as const }
    case 'pending': return { label: 'pending' as const, intent: 'warning' as const }
    case 'error': return { label: 'error' as const, intent: 'negative' as const }
    case 'revoked': return { label: 'revoked' as const, intent: 'warning' as const }
    case 'expired': return { label: 'expired' as const, intent: 'warning' as const }
    case 'disabled': return { label: 'disabled' as const, intent: 'neutral' as const }
    default: return { label: 'unknown' as const, intent: 'neutral' as const }
  }
}

export function connectionRecovery(status: string) {
  if (status === 'active') return null
  if (status === 'revoked' || status === 'expired') return 'reconnect'
  if (status === 'pending') return 'pending'
  if (status === 'error') return 'error'
  return 'unknown'
}

export function repoAnalysisResult(response: { ok: boolean; status?: number; data: unknown }) {
  if (response.ok) {
    const parsed = parseAnalysisStart(response.data, '', [])
    if (parsed?.run.mode === 'trigger') return { kind: 'started' as const, run: parsed.run }
    return { kind: 'unconfirmed' as const }
  }
  const code = response.data && typeof response.data === 'object' && 'error' in response.data ? response.data.error : null
  if (code === 'trigger_required') return { kind: 'rejected' as const, reason: 'triggerRequired' as const }
  if (code === 'quota_exceeded') return { kind: 'rejected' as const, reason: 'quota' as const }
  if (['unauthorized', 'forbidden', 'data_source_forbidden', 'cross_org_not_allowed'].includes(String(code))) return { kind: 'rejected' as const, reason: 'forbidden' as const }
  if (response.status && response.status >= 400 && response.status < 500) return { kind: 'rejected' as const, reason: 'rejected' as const }
  return { kind: 'unconfirmed' as const }
}

export type IntegrationReturnParams = { connected?: unknown; connecting?: unknown; projects?: unknown; skipped?: unknown; repos?: unknown; team?: unknown; error?: unknown; supabaseConnection?: unknown }

/** URL parameters describe a callback, not an authoritative connection snapshot. */
export function integrationReturnNotice(params: IntegrationReturnParams) {
  if (params.error) {
    const reason = ['access_denied', 'user_cancelled'].includes(String(params.error)) ? 'cancelled'
      : ['invalid_state', 'missing_code', 'missing_installation'].includes(String(params.error)) ? 'restart'
        : ['installation_claimed', 'workspace_already_connected'].includes(String(params.error)) ? 'claimed' : 'failed'
    return { kind: 'error' as const, reason }
  }
  const provider = params.connecting === 'supabase' ? 'Supabase'
    : params.connected === 'supabase' ? 'Supabase' : params.connected === 'github' ? 'GitHub' : params.connected === 'slack' ? 'Slack' : null
  if (!provider) return null
  const skipped = typeof params.skipped === 'string' && /^\d+$/.test(params.skipped) && Number.isSafeInteger(Number(params.skipped)) && Number(params.skipped) > 0
  return { kind: 'returned' as const, provider, importing: params.connecting === 'supabase', planLimited: provider === 'Supabase' && skipped }
}
