import { createHash, randomBytes } from 'node:crypto'

import { requireAdminClient } from '@/utils/supabase/admin'

/**
 * supalens `sl_` API keys for MCP / programmatic access.
 *
 * The plaintext key is shown to the user EXACTLY ONCE at mint time; we persist only a
 * one-way hash (`api_keys.token_hash`) + a non-secret `prefix`/`last_four` for display.
 * This mirrors `docs/db-schema.md` §7: self-keys are verify-only, so a one-way hash is
 * correct (never reversible). All reads/writes go through the service-role admin client
 * because `api_keys` is revoked from `anon`/`authenticated` (RLS).
 */

const KEY_PREFIX = 'sl_live_'
const PREFIX_LOOKUP_LEN = 12 // sl_live_ + 4 chars — non-secret, for display only

/** sha256(token [+ optional server pepper]) as base64. High-entropy tokens need no salt. */
export function hashKey(token: string): string {
  const pepper = process.env.API_KEY_PEPPER ?? ''
  return createHash('sha256').update(`${token}${pepper}`).digest('base64')
}

export interface MintedKey {
  /** plaintext — returned ONCE, never stored. */
  token: string
  id: string
  prefix: string
  lastFour: string
}

/** Generate + persist a new `sl_` key for an org. Returns the plaintext once. */
export async function mintApiKey(args: {
  orgId: string
  createdBy?: string | null
  scopes?: string[]
}): Promise<MintedKey> {
  const admin = requireAdminClient()
  const token = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  const prefix = token.slice(0, PREFIX_LOOKUP_LEN)
  const lastFour = token.slice(-4)

  const { data, error } = await admin
    .from('api_keys')
    .insert({
      org_id: args.orgId,
      kind: 'sl_api_key',
      prefix,
      token_hash: hashKey(token),
      last_four: lastFour,
      scopes: args.scopes ?? ['read', 'write'],
      created_by: args.createdBy ?? null,
    })
    .select('id')
    .limit(1)

  if (error || !data?.[0]) throw new Error(`failed to mint api key: ${error?.message ?? 'unknown'}`)
  return { token, id: (data[0] as { id: string }).id, prefix, lastFour }
}

export interface VerifiedKey {
  orgId: string
  apiKeyId: string
  createdBy: string | null
  scopes: string[]
}

/**
 * Verify a presented bearer token. Returns the token's org context, or null if the key
 * is unknown / revoked / expired. Best-effort updates `last_used_at`.
 */
export async function verifyApiKey(token: string): Promise<VerifiedKey | null> {
  if (!token || !token.startsWith(KEY_PREFIX)) return null
  const admin = requireAdminClient()

  const { data, error } = await admin
    .from('api_keys')
    .select('id, org_id, kind, scopes, created_by, revoked_at, expires_at')
    .eq('token_hash', hashKey(token))
    .eq('kind', 'sl_api_key')
    .limit(1)

  const row = data?.[0] as
    | { id: string; org_id: string; scopes: string[]; created_by: string | null; revoked_at: string | null; expires_at: string | null }
    | undefined
  if (error || !row) return null
  if (row.revoked_at) return null
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null

  // fire-and-forget; never block auth on the bookkeeping write.
  void admin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => undefined, () => undefined)

  return { orgId: row.org_id, apiKeyId: row.id, createdBy: row.created_by, scopes: row.scopes ?? [] }
}

export interface ApiKeySummary {
  id: string
  prefix: string
  lastFour: string | null
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/** List an org's `sl_` keys (no secret material) for the settings UI. */
export async function listApiKeys(orgId: string): Promise<ApiKeySummary[]> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('api_keys')
    .select('id, prefix, last_four, scopes, created_at, last_used_at, revoked_at')
    .eq('org_id', orgId)
    .eq('kind', 'sl_api_key')
    .order('created_at', { ascending: false })

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    prefix: String(r.prefix),
    lastFour: (r.last_four as string | null) ?? null,
    scopes: (r.scopes as string[] | null) ?? [],
    createdAt: String(r.created_at),
    lastUsedAt: (r.last_used_at as string | null) ?? null,
    revokedAt: (r.revoked_at as string | null) ?? null,
  }))
}

/** Revoke a key (scoped to its org so one tenant can't revoke another's). */
export async function revokeApiKey(orgId: string, keyId: string): Promise<boolean> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .select('id')
  return Boolean(data?.length)
}

/**
 * Revoke every active credential a USER created for an org — ALL kinds (`sl_api_key`,
 * `mcp_access_token`, `mcp_refresh_token`), called when the user is removed from / leaves the
 * org. verifyMcpToken already re-checks the creator's membership live (the actual security
 * boundary); this additionally retires the now-dead rows so they can't linger as active-looking
 * credentials in the settings UI. Best-effort by contract: never throws.
 */
export async function revokeApiKeysForUser(orgId: string, userId: string): Promise<number> {
  const admin = requireAdminClient()
  const { data, error } = await admin
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('created_by', userId)
    .is('revoked_at', null)
    .select('id')
  if (error) {
    console.error(`[mcp-keys] revokeApiKeysForUser failed for ${userId}@${orgId}:`, error.message)
    return 0
  }
  return data?.length ?? 0
}

/**
 * Revoke every active key for an org — used by org/account deletion so an `sl_` key minted
 * before deletion can't keep authenticating MCP tool calls (verifyApiKey checks only
 * `revoked_at`/`expires_at` on the key row itself, never `organizations.deleted_at`).
 */
export async function revokeAllApiKeysForOrg(orgId: string): Promise<number> {
  const admin = requireAdminClient()
  const { data, error } = await admin
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .select('id')
  if (error) throw new Error(`revoke api keys failed: ${error.message}`)
  return data?.length ?? 0
}
