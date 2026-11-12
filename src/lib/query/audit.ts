import { createAdminClient } from '@/utils/supabase/admin'
import type { Actor } from '@/lib/secrets/service'

/**
 * Record every query the engine runs to audit_log. Best-effort: auditing must never
 * break the query path. The SQL is truncated and contains no secrets (creds live in the
 * connection, not the query text); the db_password reveal itself is logged separately to
 * secret_access_log by revealSecret.
 */
export async function recordQueryAudit(a: {
  orgId: string
  dataSourceId: string
  actor: Actor
  sql: string
  rowCount?: number
  durationMs?: number
  truncated?: boolean
  error?: unknown
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  try {
    await admin.from('audit_log').insert({
      org_id: a.orgId,
      actor_id: a.actor.id ?? null,
      actor_kind: a.actor.kind,
      action: a.error ? 'data_source.query.error' : 'data_source.query',
      entity: 'data_source',
      entity_id: a.dataSourceId,
      diff: {
        sql: a.sql.slice(0, 2000),
        row_count: a.rowCount ?? null,
        duration_ms: a.durationMs ?? null,
        truncated: a.truncated ?? null,
        error: a.error ? String(a.error).slice(0, 500) : undefined,
      },
    })
  } catch {
    /* swallow — audit failure must not fail the query */
  }
}
