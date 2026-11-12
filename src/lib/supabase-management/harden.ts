// NOTE: intentionally NOT `import 'server-only'` — composes Trigger-shared modules
// (admin client, supabase-oauth tokens, management client). Currently only called from
// the Vercel introspect route, but kept unmarked so a Trigger path could reuse it.
import { requireAdminClient } from '@/utils/supabase/admin'
import { getValidAccessToken, isReconnectRequired } from '@/lib/supabase-oauth/tokens'
import { isSqlEngine } from '@/lib/data-sources/engines'
import { SupabaseManagementClient } from './client'
import { hardenReadonlyRole } from './bootstrap'

/**
 * Re-grant / backfill a Supabase data source's supalens_ro role WITHOUT rotating its
 * password (stored creds keep working). Two jobs, both idempotent:
 *  1. strip a legacy `pg_read_all_data` grant (older roles leaked system schemas —
 *     vault/pgsodium/extensions/net/auth); and
 *  2. cover user schemas created since the last mint (the explicit-grant model's coverage gap).
 *
 * Best-effort: only acts on a Supabase-connected SQL source, never throws. Returns a small
 * status so callers can log without branching. See docs/supabase.md §6 and
 * src/lib/supabase-management/bootstrap.ts.
 */
export async function hardenDataSourceRole(
  dataSourceId: string
): Promise<{ hardened: boolean; reason?: string }> {
  try {
    const admin = requireAdminClient()
    const { data, error } = await admin
      .from('data_sources')
      .select('engine, provider, connection_id, config')
      .eq('id', dataSourceId)
      .is('deleted_at', null)
      .limit(1)
    if (error) throw error
    const ds = data?.[0] as
      | {
          engine: string
          provider: string | null
          connection_id: string | null
          config: Record<string, unknown> | null
        }
      | undefined
    if (!ds) return { hardened: false, reason: 'not_found' }

    // Only Supabase-OAuth SQL sources have a supalens_ro role reachable via the Management API.
    // Direct-DB (user-supplied creds), demo, and Firestore sources have no such role.
    if (ds.provider !== 'supabase' || !ds.connection_id) return { hardened: false, reason: 'not_supabase_connected' }
    if (!isSqlEngine(ds.engine)) return { hardened: false, reason: 'not_sql' }

    const ref = ds.config?.project_ref
    if (typeof ref !== 'string' || !ref) return { hardened: false, reason: 'no_project_ref' }

    const { accessToken } = await getValidAccessToken(ds.connection_id, { kind: 'system', id: 'harden-role' })
    await hardenReadonlyRole(new SupabaseManagementClient(accessToken), ref)
    return { hardened: true }
  } catch (e) {
    // Nothing to harden on a dead grant, and nothing to alarm about — the connection is already
    // marked revoked and the user is being asked to reconnect. Keep it out of the warning stream.
    if (isReconnectRequired(e)) return { hardened: false, reason: 'reconnect_required' }
    console.warn('[harden] hardenDataSourceRole failed:', e)
    return { hardened: false, reason: 'error' }
  }
}
