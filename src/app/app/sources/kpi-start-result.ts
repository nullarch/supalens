export type KpiStartResult = { kind: 'accepted' | 'running' | 'quota' | 'unknown' } | { kind: 'rejected'; code?: string }

/** HTTP conflicts include invalid repositories; only the exact busy code means running. */
export function classifyKpiStart(status: number, payload: unknown): KpiStartResult {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const code = typeof data?.error === 'string' ? data.error : undefined
  if (status === 409 && code === 'extraction_in_progress') return { kind: 'running' }
  if (status === 402 && code === 'quota_exceeded') return { kind: 'quota' }
  if (status >= 200 && status < 300) {
    return data?.ok === true && typeof data.extractionId === 'string' && data.extractionId.trim() && (data.tier === 1 || data.tier === 2)
      ? { kind: 'accepted' } : { kind: 'unknown' }
  }
  if (status >= 400 && status < 500) return { kind: 'rejected', code }
  if (code && ['trigger_required', 'trigger_failed', 'supabase_not_configured'].includes(code)) return { kind: 'rejected', code }
  return { kind: 'unknown' }
}
