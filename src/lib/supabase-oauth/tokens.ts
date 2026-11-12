// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev
// process-revocations task (plain Node bundle), same convention as utils/supabase/admin.ts.
import * as Sentry from '@sentry/node'

import { requireAdminClient } from '@/utils/supabase/admin'
import { casUpdateSecret, getCurrentSecret, revealSecret, revokeSecret, type Actor } from '@/lib/secrets/service'
import { OAuthError, refreshTokens } from './client'
import { isReconnectRequiredError } from './errors'
import { sha256b64 } from './pkce'

const MAX_REFRESH_ATTEMPTS = 4

/**
 * Supabase's token endpoint does not speak RFC 6749 error codes: an unknown / already-
 * rotated / revoked refresh token returns **404 "No such refresh token found"** (measured
 * 2026-07-11), not 401/invalid_grant. Match every shape so the rotate-race recovery and
 * reuse-detection paths below actually fire against the real API. 422 ("Unrecognized
 * client_id" — bad SUPA_CONNECT_* host env) is deliberately EXCLUDED: that is host
 * misconfig, not a dead grant, and must never revoke the stored connection.
 */
export function isInvalidGrantError(err: OAuthError): boolean {
  return (
    err.status === 401 ||
    err.code === 'invalid_grant' ||
    (err.status === 404 && /refresh token/i.test(err.message))
  )
}

export class ReconnectRequiredError extends Error {
  constructor(
    readonly connectionId: string,
    readonly reason: 'revoked' | 'reuse_detected'
  ) {
    // Internal diagnostic text ONLY — it names a connection id, so it must never be persisted
    // into a rendered column or returned to a client. Callers translate it with
    // `isReconnectRequired` + the RECONNECT_REQUIRED code from ./errors.
    super(`Supabase connection ${connectionId} requires reconnect (${reason}).`)
    this.name = 'ReconnectRequiredError'
  }
}

/**
 * Typed guard for the reconnect fault. Prefer this over `instanceof` at call sites: the
 * name-based check in ./errors also holds across the Next/Trigger bundle boundary, where two
 * copies of this module mean `instanceof` can be false for a genuine reconnect error.
 */
export function isReconnectRequired(err: unknown): err is ReconnectRequiredError {
  return err instanceof ReconnectRequiredError || isReconnectRequiredError(err)
}

interface ConnectionRow {
  id: string
  org_id: string
  status: string
  refresh_generation: number
  prev_refresh_hash: string | null
}

/**
 * Return a valid Management API access token for a connection, refreshing (and
 * rotating the stored single-use refresh token) as needed. Handles the serverless
 * concurrency cases from docs/db-schema.md §4.1:
 *   - CAS miss  -> a peer already rotated; re-read and retry.
 *   - invalid_grant + version advanced -> peer rotated; retry with the new token.
 *   - invalid_grant + version unchanged -> genuine revoke (+ reuse detection).
 */
export async function getValidAccessToken(
  connectionId: string,
  actor: Actor = { kind: 'system' }
): Promise<{ accessToken: string; expiresIn: number }> {
  const admin = requireAdminClient()

  const readConn = async (): Promise<ConnectionRow> => {
    const { data, error } = await admin
      .from('provider_connections')
      .select('id, org_id, status, refresh_generation, prev_refresh_hash')
      .eq('id', connectionId)
      .limit(1)
    if (error) throw error
    if (!data || data.length === 0) throw new Error(`connection not found: ${connectionId}`)
    return data[0] as ConnectionRow
  }

  for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt++) {
    // re-read each iteration so generation/prev_refresh_hash are never based on a stale snapshot
    const conn = await readConn()
    if (conn.status === 'revoked') throw new ReconnectRequiredError(connectionId, 'revoked')
    if (conn.status === 'pending') throw new Error('connection authorization is being updated')

    const meta = await getCurrentSecret({ kind: 'oauth_refresh_token', parent: { connectionId } })
    if (!meta) throw new ReconnectRequiredError(connectionId, 'revoked')

    const refreshToken = await revealSecret(meta.id, { actor, purpose: 'oauth_refresh' })

    let tokens
    try {
      tokens = await refreshTokens(refreshToken)
    } catch (err) {
      if (err instanceof OAuthError && isInvalidGrantError(err)) {
        // Peer rotated, or genuinely revoked? A single immediate re-read raced the peer's
        // casUpdateSecret (KEK re-wrap + two DB writes): reading BEFORE it committed showed the
        // old version and mis-declared a live grant "genuinely revoked" → markRevoked → the user
        // forced to reconnect. Re-read with a short backoff so an in-flight peer rotation has
        // time to land before we conclude the grant is dead.
        let rotatedByPeer = false
        for (const delayMs of [0, 300, 800, 1500]) {
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
          const newMeta = await getCurrentSecret({ kind: 'oauth_refresh_token', parent: { connectionId } })
          if (newMeta && (newMeta.id !== meta.id || newMeta.version > meta.version)) {
            rotatedByPeer = true
            break
          }
        }
        if (rotatedByPeer) continue // peer rotated; retry with the new token
        // genuine failure — reuse detection
        const reuse = conn.prev_refresh_hash != null && sha256b64(refreshToken) === conn.prev_refresh_hash
        if (!(await markRevoked(connectionId, conn.org_id, reuse, conn.refresh_generation, meta.id))) continue
        await revokeSecret(meta.id, {
          reason: reuse ? 'refresh_token_reuse_detected' : 'upstream_revoked',
          actor,
        })
        throw new ReconnectRequiredError(connectionId, reuse ? 'reuse_detected' : 'revoked')
      }
      // Anything else is a HOST/system fault, never an expected grant-lifecycle event:
      // bad SUPA_CONNECT_* env (422 "Unrecognized client_id"), missing env ("not
      // configured"), Supabase 5xx. These otherwise surface only as polite agent
      // apologies (tool errors are returned to the model, not thrown, so neither
      // tasks.onFailure nor the route error handlers ever see them) — the 2026-07-11
      // outage ran silent for 3h this way. Additive only: the error is still thrown.
      Sentry.captureException(err, {
        tags: { module: 'supabase_oauth_refresh' },
        extra: { connectionId, attempt },
      })
      throw err
    }

    // success — atomically replace the stored refresh token
    const newVersion = await casUpdateSecret({
      secretId: meta.id,
      orgId: meta.orgId,
      kind: 'oauth_refresh_token',
      newPlaintext: tokens.refreshToken,
      expectedVersion: meta.version,
      actor,
    })
    if (newVersion === null) continue // peer rotated between read and write; retry

    const recorded = await admin
      .from('provider_connections')
      .update({
        refresh_generation: conn.refresh_generation + 1,
        prev_refresh_hash: sha256b64(refreshToken),
        token_refreshed_at: new Date().toISOString(),
        status: 'active',
      })
      .eq('id', connectionId)
      .eq('org_id', conn.org_id)
      .eq('refresh_generation', conn.refresh_generation)
      .eq('status', conn.status)
      .is('deleted_at', null)
      .select('id')
    if (recorded.error) throw recorded.error
    if (recorded.data?.length !== 1) continue

    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn }
  }

  throw new Error(`exhausted refresh attempts for connection ${connectionId}`)
}

/**
 * Cached access token for high-frequency callers (the Management-API query transport).
 * `getValidAccessToken` ROTATES the stored single-use refresh token on every call — calling
 * it per query would churn rotations and race the CAS under concurrency. This layer:
 *   - caches the access token per connection until near expiry (60s safety margin),
 *   - single-flights concurrent refreshes (one rotation, everyone awaits it).
 * The token lives in process memory only, TTL-bounded — same containment model as the
 * decrypted-credential cache in query/dsn.ts. Invalidate on disconnect/revoke.
 */
const ACCESS_EXPIRY_MARGIN_MS = 60_000
const accessCache = new Map<string, { token: string; expiresAt: number }>()
const inflightRefresh = new Map<string, Promise<{ accessToken: string; expiresIn: number }>>()
const cacheEpoch = new Map<string, number>()

export async function getCachedAccessToken(
  connectionId: string,
  actor: Actor = { kind: 'system' }
): Promise<string> {
  const hit = accessCache.get(connectionId)
  if (hit && hit.expiresAt > Date.now() + ACCESS_EXPIRY_MARGIN_MS) return hit.token
  const epoch = cacheEpoch.get(connectionId) ?? 0

  let p = inflightRefresh.get(connectionId)
  if (!p) {
    p = getValidAccessToken(connectionId, actor).finally(() => {
      if (inflightRefresh.get(connectionId) === p) inflightRefresh.delete(connectionId)
    })
    inflightRefresh.set(connectionId, p)
  }
  const { accessToken, expiresIn } = await p
  if ((cacheEpoch.get(connectionId) ?? 0) !== epoch) throw new Error('connection authorization changed during refresh')
  accessCache.set(connectionId, {
    token: accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  })
  return accessToken
}

/** Drop the cached access token (disconnect/revoke, or a 401 from the API). */
export function invalidateAccessToken(connectionId: string): void {
  accessCache.delete(connectionId)
  cacheEpoch.set(connectionId, (cacheEpoch.get(connectionId) ?? 0) + 1)
  inflightRefresh.delete(connectionId)
}

async function markRevoked(connectionId: string, orgId: string, reuse: boolean, generation: number, secretId: string): Promise<boolean> {
  invalidateAccessToken(connectionId)
  const admin = requireAdminClient()
  const saved = await admin
    .from('provider_connections')
    .update({
      status: 'revoked',
      ...(reuse ? { reuse_detected_at: new Date().toISOString() } : {}),
    })
    .eq('id', connectionId)
    .eq('org_id', orgId)
    .eq('refresh_generation', generation)
    .is('deleted_at', null)
    .select('id')
  if (saved.error) throw saved.error
  if (saved.data?.length !== 1) return false
  await admin.from('credential_revocations').insert({
    connection_id: connectionId,
    org_id: orgId,
    kind: 'oauth_grant',
    status: 'pending',
    payload: { secret_id: secretId },
  })
  return true
}
