import { createHash, randomBytes } from 'node:crypto'

import { getPublicOrigin } from 'mcp-handler'

import { requireAdminClient } from '@/utils/supabase/admin'

import { hashKey } from './keys'
import { fetchClientMetadata } from './client-metadata'

/**
 * OAuth 2.1 (PKCE) authorization server for the MCP endpoint. supalens IS the AS:
 * it identifies clients by a Client ID Metadata Document (CIMD, the MCP 2026-07-28 way — the
 * client_id is an HTTPS URL, nothing is registered) and still accepts dynamically registered
 * clients (DCR, deprecated in that revision) so connections made before it keep working. It
 * authorizes via the user's Supabase session + consent,
 * and issues access/refresh tokens stored in `api_keys` (mcp_access_token / _refresh_token).
 * Public clients only (token_endpoint_auth_method=none) — PKCE S256 is mandatory.
 */

export const ACCESS_PREFIX = 'slat_'
export const REFRESH_PREFIX = 'slrt_'
const ACCESS_TTL_SEC = 3600
const CODE_TTL_SEC = 600
const DEFAULT_SCOPES = ['read', 'write']

const b64url = (b: Buffer) => b.toString('base64url')
const sha256url = (s: string) => b64url(createHash('sha256').update(s).digest())

// ── URLs / metadata ─────────────────────────────────────────────────────────
export function issuer(req: Request): string {
  return getPublicOrigin(req)
}
export function resourceUrl(req: Request): string {
  const iss = issuer(req)
  // The resource identifier must match the URL clients actually connect to (RFC 9728 —
  // strict clients reject a mismatch). On the vanity MCP host the handler's PUBLIC path
  // is /mcp (next.config rewrite); everywhere else it's the internal route path.
  return new URL(iss).hostname === 'mcp.supalens.ai' ? `${iss}/mcp` : `${iss}/api/mcp/mcp`
}

export function protectedResourceMetadata(req: Request) {
  return {
    resource: resourceUrl(req),
    authorization_servers: [issuer(req)],
    bearer_methods_supported: ['header'],
    scopes_supported: DEFAULT_SCOPES,
    resource_name: 'Supalens',
  }
}

/** RFC 9728 §3.1: the path-suffixed metadata URL, which clients try before the root one. */
export function resourceMetadataUrl(req: Request): string {
  const resource = new URL(resourceUrl(req))
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`
}

/**
 * The `WWW-Authenticate` value that lets an OAuth client start (or redo) sign-in on its own.
 * A request that carried NO credential gets no error code (RFC 6750 §3.1) — `invalid_token` there
 * makes a client tell a signed-out user that their login expired. Pass `rejected` only when a
 * token was presented and failed.
 */
export function signInChallenge(req: Request, rejected?: string): string {
  const pointer = `resource_metadata="${resourceMetadataUrl(req)}", scope="${DEFAULT_SCOPES.join(' ')}"`
  if (rejected === undefined) return `Bearer ${pointer}`
  return `Bearer error="invalid_token", error_description="${rejected.replace(/["\\]/g, '')}", ${pointer}`
}

export function authServerMetadata(req: Request) {
  const iss = issuer(req)
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/api/oauth/authorize`,
    token_endpoint: `${iss}/api/oauth/token`,
    revocation_endpoint: `${iss}/api/oauth/revoke`,
    // DCR stays for clients that predate CIMD; a client that supports both prefers CIMD.
    registration_endpoint: `${iss}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    // The two fields a 2026-07-28 client checks before it identifies itself with a metadata
    // document instead of registering: this flag and "none" above.
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: DEFAULT_SCOPES,
  }
}

// ── dynamic client registration (RFC 7591) ───────────────────────────────────
export interface OAuthClient {
  client_id: string
  redirect_uris: string[]
  client_name: string | null
  token_endpoint_auth_method: string
  grant_types: string[]
}

export async function registerClient(input: {
  redirect_uris?: unknown
  client_name?: unknown
  grant_types?: unknown
}): Promise<OAuthClient> {
  const redirect_uris = Array.isArray(input.redirect_uris)
    ? input.redirect_uris.filter((u): u is string => typeof u === 'string')
    : []
  if (!redirect_uris.length) throw new Error('redirect_uris is required')
  for (const u of redirect_uris) {
    if (!/^https?:\/\//.test(u) && !u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost'))
      throw new Error(`invalid redirect_uri: ${u}`)
  }
  const client_id = `mcpc_${randomBytes(16).toString('hex')}`
  const grant_types = Array.isArray(input.grant_types)
    ? (input.grant_types as string[])
    : ['authorization_code', 'refresh_token']
  const client_name = typeof input.client_name === 'string' ? input.client_name : null

  const { error } = await requireAdminClient()
    .from('oauth_clients')
    .insert({ client_id, redirect_uris, client_name, token_endpoint_auth_method: 'none', grant_types })
  if (error) throw new Error(`client registration failed: ${error.message}`)
  return { client_id, redirect_uris, client_name, token_endpoint_auth_method: 'none', grant_types }
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const { data } = await requireAdminClient()
    .from('oauth_clients')
    .select('client_id, redirect_uris, client_name, token_endpoint_auth_method, grant_types')
    .eq('client_id', clientId)
    .limit(1)
  return (data?.[0] as OAuthClient | undefined) ?? null
}

/**
 * Resolve a client by id, whichever way it identifies itself. An HTTPS URL is a Client ID
 * Metadata Document: fetched (SSRF-checked, cached) and mirrored into `oauth_clients` so the
 * codes and tokens that reference the client keep their foreign key — the document is re-read on
 * the next authorization, so the row never outlives what the client publishes. Anything else is a
 * registered client. Throws ClientMetadataError when a document is unreachable or invalid.
 */
export async function resolveClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId.startsWith('https://')) return getClient(clientId)
  const doc = await fetchClientMetadata(clientId)
  const client: OAuthClient = {
    client_id: doc.clientId,
    redirect_uris: doc.redirectUris,
    client_name: doc.clientName,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
  }
  const { error } = await requireAdminClient().from('oauth_clients').upsert(client, { onConflict: 'client_id' })
  if (error) throw new Error(`client lookup failed: ${error.message}`)
  return client
}

// ── authorization codes ───────────────────────────────────────────────────────
export async function createAuthCode(args: {
  clientId: string
  orgId: string
  userId: string | null
  redirectUri: string
  codeChallenge: string
  scope?: string | null
  resource?: string | null
}): Promise<string> {
  const code = `mcpac_${randomBytes(32).toString('base64url')}`
  const { error } = await requireAdminClient().from('oauth_auth_codes').insert({
    code_hash: hashKey(code),
    client_id: args.clientId,
    org_id: args.orgId,
    user_id: args.userId,
    redirect_uri: args.redirectUri,
    code_challenge: args.codeChallenge,
    scope: args.scope ?? null,
    resource: args.resource ?? null,
    expires_at: new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString(),
  })
  if (error) throw new Error(`failed to issue code: ${error.message}`)
  return code
}

/** Consume a code (single-use), verifying PKCE + redirect_uri + client binding. */
export async function consumeAuthCode(
  code: string,
  opts: { clientId: string; redirectUri: string; codeVerifier: string }
): Promise<{ orgId: string; userId: string | null; scope: string | null }> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('oauth_auth_codes')
    .select('*')
    .eq('code_hash', hashKey(code))
    .limit(1)
  const row = data?.[0] as
    | {
        client_id: string
        org_id: string
        user_id: string | null
        redirect_uri: string
        code_challenge: string
        scope: string | null
        expires_at: string
        consumed_at: string | null
      }
    | undefined
  if (!row) throw new Error('invalid_grant: unknown code')
  if (row.consumed_at) throw new Error('invalid_grant: code already used')
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error('invalid_grant: code expired')
  if (row.client_id !== opts.clientId) throw new Error('invalid_grant: client mismatch')
  if (row.redirect_uri !== opts.redirectUri) throw new Error('invalid_grant: redirect_uri mismatch')
  if (sha256url(opts.codeVerifier) !== row.code_challenge) throw new Error('invalid_grant: PKCE verification failed')

  // single-use: mark consumed (guard against double-spend race via the filter)
  const { data: consumed } = await admin
    .from('oauth_auth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', hashKey(code))
    .is('consumed_at', null)
    .select('code_hash')
  if (!consumed?.length) throw new Error('invalid_grant: code already used')

  return { orgId: row.org_id, userId: row.user_id, scope: row.scope }
}

// ── token issuance / verification ─────────────────────────────────────────────
export interface IssuedTokens {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
}

export async function issueTokens(args: {
  orgId: string
  userId: string | null
  clientId: string
  scope?: string | null
}): Promise<IssuedTokens> {
  const admin = requireAdminClient()
  const scopes = args.scope ? args.scope.split(/\s+/).filter(Boolean) : DEFAULT_SCOPES
  const access = `${ACCESS_PREFIX}${randomBytes(32).toString('base64url')}`
  const refresh = `${REFRESH_PREFIX}${randomBytes(32).toString('base64url')}`

  const rows = [
    {
      org_id: args.orgId,
      kind: 'mcp_access_token',
      prefix: access.slice(0, 12),
      token_hash: hashKey(access),
      last_four: access.slice(-4),
      scopes,
      created_by: args.userId,
      client_id: args.clientId,
      expires_at: new Date(Date.now() + ACCESS_TTL_SEC * 1000).toISOString(),
    },
    {
      org_id: args.orgId,
      kind: 'mcp_refresh_token',
      prefix: refresh.slice(0, 12),
      token_hash: hashKey(refresh),
      last_four: refresh.slice(-4),
      scopes,
      created_by: args.userId,
      client_id: args.clientId,
    },
  ]
  const { error } = await admin.from('api_keys').insert(rows)
  if (error) throw new Error(`failed to issue tokens: ${error.message}`)
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ACCESS_TTL_SEC, scope: scopes.join(' ') }
}

/** Verify an issued OAuth access token. Returns org context or null. */
export async function verifyAccessToken(
  token: string
): Promise<{ orgId: string; apiKeyId: string; createdBy: string | null; scopes: string[] } | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null
  const admin = requireAdminClient()
  const { data } = await admin
    .from('api_keys')
    .select('id, org_id, scopes, created_by, revoked_at, expires_at')
    .eq('token_hash', hashKey(token))
    .eq('kind', 'mcp_access_token')
    .limit(1)
  const row = data?.[0] as
    | { id: string; org_id: string; scopes: string[]; created_by: string | null; revoked_at: string | null; expires_at: string | null }
    | undefined
  if (!row || row.revoked_at) return null
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null
  void admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => undefined, () => undefined)
  return { orgId: row.org_id, apiKeyId: row.id, createdBy: row.created_by, scopes: row.scopes ?? [] }
}

/** refresh_token grant: rotate the refresh token, issue a fresh access token. */
export async function refreshTokens(refreshToken: string, clientId: string): Promise<IssuedTokens> {
  if (!refreshToken.startsWith(REFRESH_PREFIX)) throw new Error('invalid_grant: not a refresh token')
  const admin = requireAdminClient()
  const { data } = await admin
    .from('api_keys')
    .select('id, org_id, scopes, created_by, client_id, revoked_at')
    .eq('token_hash', hashKey(refreshToken))
    .eq('kind', 'mcp_refresh_token')
    .limit(1)
  const row = data?.[0] as
    | { id: string; org_id: string; scopes: string[]; created_by: string | null; client_id: string | null; revoked_at: string | null }
    | undefined
  if (!row) throw new Error('invalid_grant: unknown refresh token')
  if (row.revoked_at) {
    // A rotated-out refresh token presented again means it was copied: end the whole grant
    // (OAuth 2.1 §4.3.1), so whoever holds the newer tokens loses them too.
    await revokeGrant({ orgId: row.org_id, userId: row.created_by, clientId: row.client_id })
    throw new Error('invalid_grant: refresh token was already used')
  }
  if (row.client_id && row.client_id !== clientId) throw new Error('invalid_grant: client mismatch')

  // rotation: revoke the presented refresh token before minting new ones.
  await admin.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', row.id)
  return issueTokens({ orgId: row.org_id, userId: row.created_by, clientId, scope: (row.scopes ?? DEFAULT_SCOPES).join(' ') })
}

// ── revocation (RFC 7009) ─────────────────────────────────────────────────────
/**
 * A grant is every live OAuth token one user issued to one client in one workspace. Tokens carry
 * no grant id, so that triple is the identity; a row without a client or a creator is never
 * matched (an API key or an org-level key is not an OAuth grant).
 */
async function revokeGrant(grant: { orgId: string; userId: string | null; clientId: string | null }): Promise<void> {
  if (!grant.userId || !grant.clientId) return
  const { error } = await requireAdminClient()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('org_id', grant.orgId)
    .eq('created_by', grant.userId)
    .eq('client_id', grant.clientId)
    .in('kind', ['mcp_access_token', 'mcp_refresh_token'])
    .is('revoked_at', null)
  if (error) throw new Error(`revocation failed: ${error.message}`)
}

/** Revoke by either token of a grant; ends the whole grant. An unknown token is a silent no-op. */
export async function revokeToken(token: string): Promise<void> {
  if (!token.startsWith(ACCESS_PREFIX) && !token.startsWith(REFRESH_PREFIX)) return
  const admin = requireAdminClient()
  const { data, error } = await admin
    .from('api_keys')
    .select('id, org_id, created_by, client_id')
    .eq('token_hash', hashKey(token))
    .in('kind', ['mcp_access_token', 'mcp_refresh_token'])
    .limit(1)
  if (error) throw new Error(`revocation failed: ${error.message}`)
  const row = data?.[0] as { id: string; org_id: string; created_by: string | null; client_id: string | null } | undefined
  if (!row) return
  await admin.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', row.id).is('revoked_at', null)
  await revokeGrant({ orgId: row.org_id, userId: row.created_by, clientId: row.client_id })
}
