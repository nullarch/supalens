import { isConnectionErrorCode } from '@/lib/supabase-oauth/errors'

export const RECOVERY_KINDS = ['authorization', 'scalar', 'seriesLong', 'seriesShort', 'sourceRemoved', 'unknown'] as const
export type RecoveryKind = typeof RECOVERY_KINDS[number]
export function recoveryKind(error: string | null | undefined): RecoveryKind | null {
  if (!error) return null
  if (isConnectionErrorCode(error)) return 'authorization'
  if (error === 'no_scalar') return 'scalar'
  if (error === 'series_too_long') return 'seriesLong'
  if (error === 'series_too_short') return 'seriesShort'
  if (error === 'source_removed') return 'sourceRemoved'
  return 'unknown'
}

export type RecoveryCheckResult =
  | { ok: true; checkedAt: string; value: number; conditionMet: boolean }
  | { ok: false; reason: 'denied' | 'unavailable' | 'paused' | 'changed' | 'unconfirmed' | 'retryLater' | RecoveryKind }

export function checkedRecoveryResult(value: unknown): RecoveryCheckResult {
  if (value && typeof value === 'object') {
    const result = value as Record<string, unknown>
    if (result.ok === true && typeof result.value === 'number' && Number.isFinite(result.value)
      && typeof result.conditionMet === 'boolean' && typeof result.checkedAt === 'string'
      && Number.isFinite(Date.parse(result.checkedAt))) return result as RecoveryCheckResult
    if (result.ok === false && [...RECOVERY_KINDS, 'denied', 'unavailable', 'paused', 'changed', 'unconfirmed', 'retryLater'].includes(result.reason as RecoveryKind)) return result as RecoveryCheckResult
  }
  return { ok: false, reason: 'unconfirmed' }
}

export const RECOVERY_RETURNS = ['authorized', 'cancelled', 'expired', 'denied', 'unavailable', 'projectMismatch', 'cleanupPending', 'changed', 'unconfirmed'] as const
export function recoveryReturn(value: unknown) {
  return typeof value === 'string' && (RECOVERY_RETURNS as readonly string[]).includes(value) ? value as typeof RECOVERY_RETURNS[number] : null
}

export interface RecoveryMonitor {
  id: string; name: string; enabled: boolean; lastError: string | null
  dataSourceId: string; dataSourceName: string | null; connectionId?: string | null
  connectionStatus?: string | null; connectionRefreshedAt?: string | null
  lastCheckedAt?: string | null; metricSql?: string; type?: string; operator?: string; threshold?: number; sensitivity?: number | null
}
/** Discard prior local verification when the server sends a newer check or definition. */
export function recoveryScope(monitors: readonly RecoveryMonitor[]) {
  return JSON.stringify(monitors.map(m => [m.id, m.dataSourceId, m.connectionId, m.connectionStatus, m.connectionRefreshedAt, m.enabled, m.lastError, m.lastCheckedAt, m.metricSql, m.type, m.operator, m.threshold, m.sensitivity]))
}
/** Persisted grant progress, not URL evidence or proof of working customer SQL. */
export function authorizationAwaitingCheck(monitor: RecoveryMonitor): boolean {
  if (!monitor.connectionId || monitor.connectionStatus !== 'active' || recoveryKind(monitor.lastError) !== 'authorization') return false
  const refreshed = Date.parse(monitor.connectionRefreshedAt ?? '')
  const checked = Date.parse(monitor.lastCheckedAt ?? '')
  return Number.isFinite(refreshed) && Number.isFinite(checked) && refreshed > checked
}
export function recoveryGroups(monitors: readonly RecoveryMonitor[]) {
  const groups = new Map<string, { key: string; connectionId: string | null; kind: RecoveryKind; monitors: RecoveryMonitor[] }>()
  for (const monitor of monitors) {
    const kind = recoveryKind(monitor.lastError)
    if (!kind) continue
    const key = kind === 'authorization' && monitor.connectionId ? `connection:${monitor.connectionId}` : `monitor:${monitor.id}`
    const group = groups.get(key) ?? { key, kind, connectionId: kind === 'authorization' ? monitor.connectionId ?? null : null, monitors: [] }
    group.monitors.push(monitor); groups.set(key, group)
  }
  return [...groups.values()]
}

/** Give unchecked monitors a turn before retrying earlier failures in large groups. */
export function recoveryBatch(monitors: readonly RecoveryMonitor[], results: Record<string, RecoveryCheckResult>) {
  const eligible = monitors.filter(monitor => monitor.enabled && !results[monitor.id]?.ok)
  return [...eligible.filter(monitor => !results[monitor.id]), ...eligible.filter(monitor => results[monitor.id])].slice(0, 5)
}

export const isRecoveryId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
export function recoveryAuthorizeHref(connectionId: string, monitorId: string): string {
  const returnTo = `/app/monitors/${encodeURIComponent(monitorId)}`
  return `/api/connect-supabase/authorize?${new URLSearchParams({ connectionId, returnTo })}`
}
