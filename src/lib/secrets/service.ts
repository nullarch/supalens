// Shared with the Trigger.dev agent runtime — no `import 'server-only'` (it throws in a
// plain Node bundle). Safe: needs the service-role admin client, server-only by nature.
import { randomUUID } from 'crypto'

import { requireAdminClient } from '@/utils/supabase/admin'
import { decryptSecret, encryptSecret } from '@/lib/crypto/envelope'

/**
 * Secrets vault service (server-only, service_role).
 *
 * Stores reversible secrets (OAuth refresh tokens, minted DB passwords) envelope-
 * encrypted, with a reveal audit trail. Client roles can never read the table
 * (RLS deny + revoke); only this service, running under the service-role key,
 * touches it. See docs/db-schema.md §4–5.
 */

export type SecretKind =
  | 'db_password'
  | 'oauth_refresh_token'
  | 'ssl_client_key'
  | 'provisioning_service_role'
  | 'gcp_service_account' // Firestore/GCP service-account JSON (reversible; attaches to a data_source)
  | 'slack_bot_token' // Slack bot token (reversible; attaches to a provider_connection)

export interface Actor {
  kind: 'user' | 'system' | 'mcp_token' | 'api_key'
  id?: string
}

export interface SecretParent {
  /** exactly one of these must be set */
  dataSourceId?: string
  connectionId?: string
}

interface SecretRow {
  id: string
  org_id: string
  kind: SecretKind
  ciphertext: string
  nonce: string
  dek_id: string
  aad_version: number
  version: number
  status: string
  access_count: number
}

async function audit(args: {
  secretId: string
  orgId: string
  action: 'create' | 'reveal' | 'rotate' | 'revoke' | 'rewrap'
  actor: Actor
  purpose?: string
  requestId?: string
}) {
  const admin = requireAdminClient()
  await admin.from('secret_access_log').insert({
    secret_id: args.secretId,
    org_id: args.orgId,
    action: args.action,
    actor_kind: args.actor.kind,
    actor_id: args.actor.id ?? null,
    purpose: args.purpose ?? null,
    request_id: args.requestId ?? null,
  })
}

function assertSingleParent(parent: SecretParent) {
  const n = (parent.dataSourceId ? 1 : 0) + (parent.connectionId ? 1 : 0)
  if (n !== 1) throw new Error('SecretParent must set exactly one of dataSourceId / connectionId')
}

/**
 * Create (or rotate-by-replace) the current secret of a given (parent, kind).
 * Any previous current secret of the same parent+kind is demoted (is_current=false).
 */
export async function putSecret(args: {
  orgId: string
  kind: SecretKind
  plaintext: string | Buffer
  parent: SecretParent
  expiresAt?: Date
  notAfter?: Date
  actor: Actor
}): Promise<string> {
  assertSingleParent(args.parent)
  const admin = requireAdminClient()
  const secretId = randomUUID()

  const enc = await encryptSecret({
    secretId,
    orgId: args.orgId,
    kind: args.kind,
    plaintext: args.plaintext,
  })

  // demote-previous-current + insert-new in ONE transaction (avoids a zero-current window)
  const { error: rpcErr } = await admin.rpc('put_current_secret', {
    p_id: secretId,
    p_org_id: args.orgId,
    p_data_source_id: args.parent.dataSourceId ?? null,
    p_connection_id: args.parent.connectionId ?? null,
    p_kind: args.kind,
    p_ciphertext: enc.ciphertext,
    p_nonce: enc.nonce,
    p_dek_id: enc.dekId,
    p_algo: enc.algo,
    p_aad_version: enc.aadVersion,
    p_expires_at: args.expiresAt?.toISOString() ?? null,
    p_not_after: args.notAfter?.toISOString() ?? null,
    p_created_by: args.actor.id ?? null,
  })
  if (rpcErr) throw rpcErr

  await audit({ secretId, orgId: args.orgId, action: 'create', actor: args.actor })
  return secretId
}

/** Look up the current secret row meta for a parent+kind (no plaintext). */
export async function getCurrentSecret(args: {
  kind: SecretKind
  parent: SecretParent
}): Promise<{ id: string; orgId: string; version: number } | null> {
  assertSingleParent(args.parent)
  const admin = requireAdminClient()
  let q = admin
    .from('secrets')
    .select('id, org_id, version')
    .eq('kind', args.kind)
    .eq('is_current', true)
    .eq('status', 'active')
  q = args.parent.dataSourceId
    ? q.eq('data_source_id', args.parent.dataSourceId)
    : q.eq('connection_id', args.parent.connectionId!)
  const { data, error } = await q.limit(1)
  if (error) throw error
  if (!data || data.length === 0) return null
  const row = data[0] as { id: string; org_id: string; version: number }
  return { id: row.id, orgId: row.org_id, version: row.version }
}

/** Reveal (decrypt) a secret value as a UTF-8 string, writing a reveal audit entry. */
export async function revealSecret(
  secretId: string,
  opts: { actor: Actor; purpose?: string; requestId?: string }
): Promise<string> {
  const admin = requireAdminClient()
  const { data, error } = await admin
    .from('secrets')
    .select('id, org_id, kind, ciphertext, nonce, dek_id, aad_version, version, status, access_count')
    .eq('id', secretId)
    .eq('status', 'active')
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) throw new Error('secret not found or inactive')
  const row = data[0] as SecretRow

  const plaintext = await decryptSecret({
    secretId: row.id,
    orgId: row.org_id,
    kind: row.kind,
    dekId: row.dek_id,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    aadVersion: row.aad_version,
  })

  await admin
    .from('secrets')
    .update({ last_accessed_at: new Date().toISOString(), access_count: row.access_count + 1 })
    .eq('id', secretId)
  await audit({
    secretId,
    orgId: row.org_id,
    action: 'reveal',
    actor: opts.actor,
    purpose: opts.purpose,
    requestId: opts.requestId,
  })

  return plaintext.toString('utf8')
}

/**
 * Compare-and-swap update of a secret's value in place (used by OAuth refresh
 * rotation). Returns the new version, or null if a peer already rotated
 * (expectedVersion no longer matches) — caller should re-read instead of re-calling
 * the upstream token endpoint. See docs/db-schema.md §4.1.
 */
export async function casUpdateSecret(args: {
  secretId: string
  orgId: string
  kind: SecretKind
  newPlaintext: string | Buffer
  expectedVersion: number
  expiresAt?: Date
  notAfter?: Date
  actor: Actor
}): Promise<number | null> {
  const admin = requireAdminClient()
  const enc = await encryptSecret({
    secretId: args.secretId,
    orgId: args.orgId,
    kind: args.kind,
    plaintext: args.newPlaintext,
  })

  const { data, error } = await admin
    .from('secrets')
    .update({
      ciphertext: enc.ciphertext,
      nonce: enc.nonce,
      dek_id: enc.dekId,
      aad_version: enc.aadVersion,
      version: args.expectedVersion + 1,
      rotated_at: new Date().toISOString(),
      expires_at: args.expiresAt?.toISOString() ?? null,
      not_after: args.notAfter?.toISOString() ?? null,
    })
    .eq('id', args.secretId)
    .eq('org_id', args.orgId)
    .eq('kind', args.kind)
    .eq('is_current', true)
    .eq('status', 'active')
    .eq('version', args.expectedVersion)
    .select('version')
  if (error) throw error
  if (!data || data.length === 0) return null // peer already rotated

  await audit({ secretId: args.secretId, orgId: args.orgId, action: 'rotate', actor: args.actor })
  return (data[0] as { version: number }).version
}

/** Soft-revoke a secret (does NOT perform upstream revoke — enqueue that separately). */
export async function revokeSecret(
  secretId: string,
  opts: { reason: string; actor: Actor }
): Promise<void> {
  const admin = requireAdminClient()
  const { data, error } = await admin
    .from('secrets')
    .update({
      status: 'revoked',
      is_current: false,
      revoked_at: new Date().toISOString(),
      revoked_reason: opts.reason,
    })
    .eq('id', secretId)
    .select('org_id')
  if (error) throw error
  if (data && data.length > 0) {
    await audit({
      secretId,
      orgId: (data[0] as { org_id: string }).org_id,
      action: 'revoke',
      actor: opts.actor,
      purpose: opts.reason,
    })
  }
}
