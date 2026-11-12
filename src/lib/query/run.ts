import type { Actor } from '@/lib/secrets/service'

import { recordQueryAudit } from './audit'
import { resolveDataSource } from './dsn'
import { executeReadOnlyWithConfig } from './execute'
import { executeViaManagementApi } from './supabase-api'
import type { ExecuteOptions, QueryResult } from './types'

/**
 * High-level read-only execution for a connected data source: resolve the transport
 * (Supabase-OAuth sources → Management API with owner-level read_only; everything else →
 * vault creds + direct pool), run the query (read-only, capped, timed out), and audit the
 * result. This is the function the agent's `execute_sql` tool and dashboards call.
 */
export async function executeReadOnly(
  dataSourceId: string,
  sql: string,
  opts: ExecuteOptions & { actor: Actor }
): Promise<QueryResult> {
  const resolved = await resolveDataSource(dataSourceId)
  const { orgId } = resolved
  try {
    // NOTE: never pass trustedCatalogQuery here — this path carries user/model-authored SQL,
    // which must stay behind the system-schema deny-list on the API transport.
    const result = resolved.supabaseApi
      ? await executeViaManagementApi(resolved.supabaseApi, sql, opts)
      : await executeReadOnlyWithConfig(dataSourceId, resolved.cfg!, sql, opts)
    await recordQueryAudit({
      orgId,
      dataSourceId,
      actor: opts.actor,
      sql,
      rowCount: result.rowCount,
      durationMs: result.durationMs,
      truncated: result.truncated,
    })
    return result
  } catch (error) {
    await recordQueryAudit({ orgId, dataSourceId, actor: opts.actor, sql, error })
    throw error
  }
}
