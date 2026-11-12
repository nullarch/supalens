import 'server-only'

import * as Sentry from '@sentry/nextjs'

import { requireAdminClient } from '@/utils/supabase/admin'
import { cleanupDataSourceDependents } from '@/lib/data-sources/cleanup'
import { getCurrentSecret, revealSecret, revokeSecret, type Actor } from '@/lib/secrets/service'
import { closePool, invalidateDataSource } from '@/lib/query'
import { SupabaseManagementClient } from '@/lib/supabase-management/client'
import { dropReadonlyRole } from '@/lib/supabase-management/bootstrap'
import { revokeGrant } from './client'
import { getValidAccessToken, invalidateAccessToken } from './tokens'

/**
 * Disconnect a Supabase connection (docs/supabase.md §Revoke, db-schema §8):
 *   1. drop minted read-only roles on each project (while the token is still valid),
 *   2. revoke the OAuth grant upstream,
 *   3. soft-revoke stored secrets and soft-delete data sources + connection,
 *   4. enqueue a revocation outbox row as the durable backstop.
 *
 * Every step is best-effort; failures are logged and the outbox covers retries.
 */
export async function disconnectSupabase(
  connectionId: string,
  actor: Actor
): Promise<{ ok: boolean }> {
  const admin = requireAdminClient()

  const { data: connData, error: connErr } = await admin
    .from('provider_connections')
    .select('id, org_id')
    .eq('id', connectionId)
    .limit(1)
  if (connErr) throw connErr
  if (!connData || connData.length === 0) return { ok: true }
  const orgId = (connData[0] as { org_id: string }).org_id

  // load this connection's data sources (project refs + db_password secrets)
  const { data: sources } = await admin
    .from('data_sources')
    .select('id, config')
    .eq('connection_id', connectionId)
    .is('deleted_at', null)

  // 1. drop minted roles while we can still get a valid token. Any role that fails to
  //    drop — including the whole loop being skipped because the token fetch failed —
  //    is a live credential leak (docs/db-schema.md "leak-by-deletion"), so each failed
  //    ref gets a durable `minted_db_role` outbox row for the process-revocations task.
  let pendingRevocations = false
  const enqueueRoleRevocation = async (projectRef: string, err: unknown) => {
    pendingRevocations = true
    await admin.from('credential_revocations').insert({
      connection_id: connectionId,
      org_id: orgId,
      kind: 'minted_db_role',
      status: 'pending',
      payload: { project_ref: projectRef },
      last_error: err instanceof Error ? err.message : String(err),
    })
  }
  const projectRefs = (sources ?? [])
    .map((s) => (s as { config: { project_ref?: string } }).config?.project_ref)
    .filter((r): r is string => Boolean(r))
  try {
    const { accessToken } = await getValidAccessToken(connectionId, actor)
    const mgmt = new SupabaseManagementClient(accessToken)
    for (const ref of projectRefs) {
      try {
        await dropReadonlyRole(mgmt, ref)
      } catch (err) {
        console.warn(`[disconnect] drop role failed for ${ref}:`, err)
        Sentry.captureException(err, { tags: { connectionId, projectRef: ref } })
        await enqueueRoleRevocation(ref, err)
      }
    }
  } catch (err) {
    console.warn('[disconnect] could not obtain token to drop roles:', err)
    Sentry.captureException(err, { tags: { connectionId } })
    for (const ref of projectRefs) await enqueueRoleRevocation(ref, err)
  }

  // 2. revoke OAuth grant upstream (using current refresh token)
  try {
    const meta = await getCurrentSecret({ kind: 'oauth_refresh_token', parent: { connectionId } })
    if (meta) {
      const refresh = await revealSecret(meta.id, { actor, purpose: 'disconnect_revoke' })
      await revokeGrant(refresh)
    }
  } catch (err) {
    console.warn('[disconnect] upstream revoke failed (will rely on outbox):', err)
    Sentry.captureException(err, { level: 'warning', tags: { connectionId } })
    pendingRevocations = true
    await admin.from('credential_revocations').insert({
      connection_id: connectionId,
      org_id: orgId,
      kind: 'oauth_grant',
      status: 'pending',
    })
  }

  // 3. soft-revoke secrets + soft-delete data sources & connection.
  //    EXCEPTION: when revocation rows are pending, the connection-level oauth
  //    secrets stay ACTIVE — the process-revocations task needs the refresh token
  //    to retry, and it revokes these secrets itself once the outbox drains.
  if (!pendingRevocations) {
    const { data: secretRows } = await admin
      .from('secrets')
      .select('id')
      .eq('connection_id', connectionId)
      .eq('is_current', true)
    for (const sr of secretRows ?? []) {
      await revokeSecret((sr as { id: string }).id, { reason: 'disconnect', actor })
    }
  }
  for (const s of sources ?? []) {
    const dsId = (s as { id: string }).id
    const { data: dsSecrets } = await admin
      .from('secrets')
      .select('id')
      .eq('data_source_id', dsId)
      .eq('is_current', true)
    for (const sr of dsSecrets ?? []) {
      await revokeSecret((sr as { id: string }).id, { reason: 'disconnect', actor })
    }
  }

  // drop cached decrypted creds + warm pools + the cached Management-API access token
  // immediately so the query engine / agent stops being able to reach these DBs without
  // waiting for the cache TTL or a restart.
  for (const s of sources ?? []) {
    const dsId = (s as { id: string }).id
    invalidateDataSource(dsId)
    await closePool(dsId)
  }
  invalidateAccessToken(connectionId)

  const now = new Date().toISOString()
  await admin
    .from('data_sources')
    .update({ status: 'disabled', deleted_at: now })
    .eq('connection_id', connectionId)
    .is('deleted_at', null)
  await admin
    .from('provider_connections')
    .update({ status: 'revoked', deleted_at: now })
    .eq('id', connectionId)

  // soft delete means FK cascades never fire — disable alerts / detach widgets explicitly
  for (const s of sources ?? []) {
    await cleanupDataSourceDependents((s as { id: string }).id)
  }

  return { ok: true }
}
