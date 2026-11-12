// NOTE: intentionally NOT `import 'server-only'` — this module is the body of the
// Trigger.dev process-revocations task (plain Node bundle), same convention as
// utils/supabase/admin.ts.
import * as Sentry from '@sentry/node'

import { requireAdminClient } from '@/utils/supabase/admin'
import { revealSecret, revokeSecret, type Actor } from '@/lib/secrets/service'
import { SupabaseManagementClient } from '@/lib/supabase-management/client'
import { dropReadonlyRole } from '@/lib/supabase-management/bootstrap'
import { revokeGrant } from './client'
import { getValidAccessToken, isReconnectRequired } from './tokens'

/**
 * Drain the `credential_revocations` outbox (docs/db-schema.md §8, the durable
 * backstop for disconnectSupabase). Two kinds:
 *   - 'minted_db_role': the supalens_ro role failed to drop at disconnect time.
 *     Retry via a fresh Management API token (the connection's refresh-token
 *     secret is deliberately left active while pending rows exist).
 *   - 'oauth_grant': the upstream grant revoke failed. Retry revokeGrant.
 * After a connection's LAST pending row completes (or permanently fails), the
 * connection's remaining oauth secrets are revoked — finishing disconnect step 3.
 */

const MAX_ATTEMPTS = 10
const SYSTEM_ACTOR: Actor = { kind: 'system', id: 'process-revocations' }

interface RevocationRow {
  id: string
  connection_id: string | null
  org_id: string
  kind: string
  attempts: number
  payload: { project_ref?: string; secret_id?: string } | null
}

export interface ProcessResult {
  processed: number
  done: number
  failed: number
  retried: number
}

async function revokeConnectionOauthSecrets(connectionId: string): Promise<void> {
  const admin = requireAdminClient()
  const { data, error } = await admin
    .from('secrets')
    .select('id, provider_connections!inner(status)')
    .eq('connection_id', connectionId)
    .eq('provider_connections.status', 'revoked')
    .eq('is_current', true)
    .eq('status', 'active')
  if (error) throw error
  for (const s of data ?? []) {
    await revokeSecret((s as { id: string }).id, { reason: 'disconnect', actor: SYSTEM_ACTOR })
  }
}

async function processRow(row: RevocationRow): Promise<'done' | 'failed' | 'retried'> {
  const admin = requireAdminClient()
  try {
    if (row.kind === 'minted_db_role') {
      if (!row.connection_id || !row.payload?.project_ref) throw new Error('missing connection_id/payload.project_ref')
      const { accessToken } = await getValidAccessToken(row.connection_id, SYSTEM_ACTOR)
      await dropReadonlyRole(new SupabaseManagementClient(accessToken), row.payload.project_ref)
    } else if (row.kind === 'oauth_grant') {
      if (!row.connection_id) throw new Error('missing connection_id')
      // Resolve secret + revoked parent in one statement. Old work may not revoke a
      // replacement grant after reauthorization, including legacy outbox rows.
      const { data, error } = await admin.from('secrets').select('id,provider_connections!inner(status)')
        .eq('connection_id', row.connection_id).eq('org_id', row.org_id).eq('kind', 'oauth_refresh_token')
        .eq('is_current', true).eq('status', 'active').eq('provider_connections.status', 'revoked').limit(1)
      if (error) throw error
      const meta = data?.[0] as { id: string } | undefined
      if (meta && (!row.payload?.secret_id || row.payload.secret_id === meta.id)) {
        const refresh = await revealSecret(meta.id, { actor: SYSTEM_ACTOR, purpose: 'revocation_retry' })
        await revokeGrant(refresh)
      }
    } else {
      throw new Error(`unknown revocation kind: ${row.kind}`)
    }

    await admin
      .from('credential_revocations')
      .update({ status: 'done', completed_at: new Date().toISOString(), last_error: null })
      .eq('id', row.id)
    return 'done'
  } catch (err) {
    const attempts = row.attempts + 1
    // A dead OAuth grant is terminal, not transient: no future attempt can mint a token for a
    // revoked connection, so retrying just burns the budget (and re-logs) every sweep.
    const permanent = attempts >= MAX_ATTEMPTS || isReconnectRequired(err)
    console.warn(`[revocations] ${row.kind} ${row.id} attempt ${attempts} failed:`, err)
    if (permanent) Sentry.captureException(err, { tags: { revocationId: row.id, kind: row.kind } })
    await admin
      .from('credential_revocations')
      .update({
        attempts,
        status: permanent ? 'failed' : 'pending',
        last_error: err instanceof Error ? err.message : String(err),
        ...(permanent ? { completed_at: new Date().toISOString() } : {}),
      })
      .eq('id', row.id)
    return permanent ? 'failed' : 'retried'
  }
}

export async function processPendingRevocations(): Promise<ProcessResult> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('credential_revocations')
    .select('id, connection_id, org_id, kind, attempts, payload')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50)
  const rows = (data ?? []) as unknown as RevocationRow[]

  const result: ProcessResult = { processed: rows.length, done: 0, failed: 0, retried: 0 }
  const touchedConnections = new Set<string>()

  for (const row of rows) {
    const outcome = await processRow(row)
    result[outcome === 'done' ? 'done' : outcome === 'failed' ? 'failed' : 'retried'] += 1
    if (row.connection_id && outcome !== 'retried') touchedConnections.add(row.connection_id)
  }

  // finish disconnect step 3 for connections whose outbox just drained: revoke the
  // oauth secrets that were kept active for these retries.
  for (const connectionId of touchedConnections) {
    const { count } = await admin
      .from('credential_revocations')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', connectionId)
      .eq('status', 'pending')
    if ((count ?? 0) === 0) {
      try {
        await revokeConnectionOauthSecrets(connectionId)
      } catch (err) {
        console.warn(`[revocations] final secret revoke failed for ${connectionId}:`, err)
        Sentry.captureException(err, { tags: { connectionId } })
      }
    }
  }

  return result
}
