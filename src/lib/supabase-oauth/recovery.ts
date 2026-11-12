import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { userHasOrgRole } from '@/lib/org/require-role'
import { requireAdminClient } from '@/utils/supabase/admin'
import { putSecret } from '@/lib/secrets/service'
import { SupabaseManagementClient } from '@/lib/supabase-management/client'
import { invalidateAccessToken } from './tokens'
import type { OAuthTokens } from './client'

export class RecoveryError extends Error {
  constructor(readonly reason: 'denied' | 'unavailable' | 'projectMismatch' | 'cleanupPending' | 'changed' | 'unconfirmed') { super(reason) }
}

export async function recoveryConnection(db: SupabaseClient, userId: string, connectionId: string) {
  const { data, error } = await db.from('provider_connections').select('id,org_id,status,refresh_generation')
    .eq('id', connectionId).eq('provider', 'supabase').is('deleted_at', null).limit(1)
  if (error || !data?.[0]) throw new RecoveryError('unavailable')
  const connection = data[0] as { id: string; org_id: string; status: string; refresh_generation: number }
  if (!(await userHasOrgRole(db, connection.org_id, userId))) throw new RecoveryError('denied')
  return connection
}

/** Existing identity only: no new sources, roles, connections, monitors or background imports. */
export async function reauthorizeConnection(db: SupabaseClient, userId: string, connectionId: string, expectedOrg: string, tokens: OAuthTokens) {
  const connection = await recoveryConnection(db, userId, connectionId)
  if (connection.org_id !== expectedOrg) throw new RecoveryError('denied')
  if (!['active', 'error', 'revoked', 'expired'].includes(connection.status)) throw new RecoveryError('changed')
  const { data: sources, error } = await db.from('data_sources').select('projectRef:config->>project_ref')
    .eq('connection_id', connection.id).eq('org_id', connection.org_id).eq('provider', 'supabase').is('deleted_at', null)
  if (error || !sources?.length) throw new RecoveryError('unavailable')
  const refs = (sources as unknown as { projectRef: unknown }[]).map(source => source.projectRef)
  const projects = await new SupabaseManagementClient(tokens.accessToken).listProjects()
  if (refs.some(ref => typeof ref !== 'string' || !projects.some(project => project.id === ref))) throw new RecoveryError('projectMismatch')
  const admin = requireAdminClient()
  // Do not race a pending cleanup that could revoke the newly issued authorization.
  const cleanup = await admin.from('credential_revocations').select('id').eq('connection_id', connection.id)
    .eq('org_id', connection.org_id).eq('status', 'pending').limit(1)
  if (cleanup.error) throw new RecoveryError('unavailable')
  if (cleanup.data?.length) throw new RecoveryError('cleanupPending')
  const generation = connection.refresh_generation + 1
  const claimed = await admin.from('provider_connections').update({ status: 'pending', refresh_generation: generation })
    .eq('id', connection.id).eq('org_id', connection.org_id).eq('status', connection.status)
    .eq('refresh_generation', connection.refresh_generation).is('deleted_at', null).select('id')
  if (claimed.error) throw new RecoveryError('unconfirmed')
  if (claimed.data?.length !== 1) throw new RecoveryError('changed')
  invalidateAccessToken(connection.id)
  try {
    await putSecret({ orgId: connection.org_id, kind: 'oauth_refresh_token', plaintext: tokens.refreshToken,
      parent: { connectionId: connection.id }, actor: { kind: 'user', id: userId } })
    const saved = await admin.from('provider_connections').update({ status: 'active', prev_refresh_hash: null, token_refreshed_at: new Date().toISOString() })
      .eq('id', connection.id).eq('org_id', connection.org_id).eq('refresh_generation', generation).eq('status', 'pending').is('deleted_at', null).select('id')
    if (saved.error || saved.data?.length !== 1) throw new RecoveryError('unconfirmed')
  } catch {
    await admin.from('provider_connections').update({ status: 'error' }).eq('id', connection.id)
      .eq('org_id', connection.org_id).eq('refresh_generation', generation).eq('status', 'pending')
    throw new RecoveryError('unconfirmed')
  }
}
