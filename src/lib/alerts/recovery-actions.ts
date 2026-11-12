'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { userHasOrgRole } from '@/lib/org/require-role'
import { executeReadOnly } from '@/lib/query'
import { isReconnectRequiredError } from '@/lib/supabase-oauth/errors'
import { rateLimit } from '@/lib/rate-limit'
import { isMissingSchemaError } from '@/lib/activation/logic'
import { getOrgTimezone } from '@/lib/org/timezone'
import type { AlertOp } from './evaluate'
import { parseCondition } from './condition'
import { evaluateMonitorResult, monitorMaxRows } from './monitor-eval'
import { isRecoveryId, type RecoveryCheckResult } from './recovery'

/** User-approved read-only query; no runner/notifications/event mutations. */
export async function verifyMonitorRecovery(id: string): Promise<RecoveryCheckResult> {
  if (!isRecoveryId(id)) return { ok: false, reason: 'unavailable' }
  try {
    const db = await createClient()
    if (!db) return { ok: false, reason: 'unavailable' }
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return { ok: false, reason: 'denied' }
    // `condition` ships in the goal-monitor migration — retry without it before that lands.
    const read = (goalCols: boolean) => db.from('alerts')
      .select(`id,org_id,data_source_id,metric_sql,type,operator,threshold,sensitivity,enabled,last_checked_at,last_error,status${goalCols ? ',condition' : ''}`)
      .eq('id', id).is('deleted_at', null).limit(1)
    let { data, error } = await read(true)
    if (error && isMissingSchemaError(error)) ({ data, error } = await read(false))
    if (error || !data?.[0]) return { ok: false, reason: 'unavailable' }
    const alert = data[0] as unknown as { id: string; org_id: string; data_source_id: string; metric_sql: string; type: string; operator: AlertOp; threshold: number; sensitivity: number | null; enabled: boolean; last_checked_at: string | null; last_error: string | null; status: string; condition?: unknown }
    if (!(await userHasOrgRole(db, alert.org_id, auth.user.id, ['owner', 'admin', 'member']))) return { ok: false, reason: 'denied' }
    if (!alert.enabled) return { ok: false, reason: 'paused' }
    // Per-process protection in addition to the disabled UI; not a distributed rate-limit claim.
    if (!rateLimit(`recovery:${alert.org_id}:${id}`, 1, 30_000).allowed) return { ok: false, reason: 'retryLater' }
    const { data: sources, error: sourceError } = await db.from('data_sources').select('id')
      .eq('id', alert.data_source_id).eq('org_id', alert.org_id).is('deleted_at', null).limit(1)
    if (sourceError) return { ok: false, reason: 'unavailable' }
    if (!sources?.length) return { ok: false, reason: 'sourceRemoved' }
    const checkedAt = new Date().toISOString()
    // the SAME evaluation seam as the runner and "test now" (monitor-eval.ts)
    const monitor = { type: alert.type, operator: alert.operator, threshold: alert.threshold, sensitivity: alert.sensitivity, condition: parseCondition(alert.condition) }
    let result
    try {
      result = await executeReadOnly(alert.data_source_id, alert.metric_sql, {
        actor: { kind: 'user', id: auth.user.id }, maxRows: monitorMaxRows(monitor), timeoutMs: 15_000,
      })
    } catch (failure) {
      return { ok: false, reason: isReconnectRequiredError(failure) ? 'authorization' : 'unknown' }
    }
    // only a goal monitor reads the org zone (it skips the bucket still in progress there)
    const timezone = monitor.condition ? await getOrgTimezone(db, alert.org_id) : 'UTC'
    const outcome = evaluateMonitorResult(monitor, result, Date.now(), timezone)
    if (!outcome.ok) {
      return { ok: false, reason: outcome.code === 'series_too_long' ? 'seriesLong' : outcome.code === 'series_too_short' ? 'seriesShort' : 'scalar' }
    }
    const { value, met } = outcome
    if (!Number.isFinite(value)) return { ok: false, reason: 'scalar' }
    // A stale check must not overwrite a newer runner result or edited/paused/deleted monitor.
    // Only execution metadata changes: incident status/hysteresis/cooldown remain runner-owned.
    let write = db.from('alerts').update({ last_error: null, last_value: value, last_checked_at: checkedAt })
      .eq('id', id).eq('org_id', alert.org_id).eq('data_source_id', alert.data_source_id)
      .eq('metric_sql', alert.metric_sql).eq('type', alert.type).eq('operator', alert.operator)
      .eq('threshold', alert.threshold).eq('enabled', true).eq('status', alert.status).is('deleted_at', null)
    write = alert.sensitivity === null ? write.is('sensitivity', null) : write.eq('sensitivity', alert.sensitivity)
    write = alert.last_checked_at === null ? write.is('last_checked_at', null) : write.eq('last_checked_at', alert.last_checked_at)
    write = alert.last_error === null ? write.is('last_error', null) : write.eq('last_error', alert.last_error)
    const saved = await write.select('id')
    if (saved.error) return { ok: false, reason: 'unconfirmed' }
    if (saved.data?.length !== 1) return { ok: false, reason: 'changed' }
    try { revalidatePath('/app/monitors'); revalidatePath(`/app/monitors/${id}`); revalidatePath('/app/overview') } catch { /* persisted result remains authoritative */ }
    return { ok: true, checkedAt, value, conditionMet: met }
  } catch { return { ok: false, reason: 'unconfirmed' } }
}
