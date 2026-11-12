// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev
// process-revocations task (plain Node bundle), same convention as utils/supabase/admin.ts.
import { SUPABASE_OAUTH, basicAuthHeader, getSupabaseOauthConfig } from './config'

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  /** seconds until the access token expires (authoritative — never hardcode). */
  expiresIn: number
  tokenType: string
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

function parseTokens(json: Record<string, unknown>): OAuthTokens {
  const accessToken = json.access_token as string | undefined
  const refreshToken = json.refresh_token as string | undefined
  if (!accessToken || !refreshToken) {
    throw new OAuthError('token endpoint returned no access/refresh token', 502)
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 86400,
    tokenType: (json.token_type as string) ?? 'Bearer',
  }
}

async function tokenRequest(body: URLSearchParams): Promise<OAuthTokens> {
  const cfg = getSupabaseOauthConfig()
  const res = await fetch(SUPABASE_OAUTH.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: basicAuthHeader(cfg),
    },
    body,
    cache: 'no-store',
  })

  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    /* non-JSON error body */
  }

  if (!res.ok) {
    throw new OAuthError(
      (json.error_description as string) ||
        (json.error as string) ||
        // Supabase's actual error body is {"message": "…"}, not RFC 6749 error/error_description
        (json.message as string) ||
        `token request failed (${res.status})`,
      res.status,
      json.error as string | undefined
    )
  }
  return parseTokens(json)
}

/** Exchange an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeCode(args: { code: string; codeVerifier: string }): Promise<OAuthTokens> {
  const cfg = getSupabaseOauthConfig()
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: cfg.redirectUri, // MUST byte-for-byte match the authorize step
      code_verifier: args.codeVerifier,
    })
  )
}

/**
 * Refresh with a stored refresh token. Single-use + rotated: the response carries a
 * NEW refresh token that MUST replace the old one atomically (see secrets.casUpdateSecret).
 * A 401/invalid_grant means either a peer already rotated or the user revoked access.
 */
export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  )
}

/** Revoke the OAuth grant (disconnect). Best-effort; safe to retry. */
export async function revokeGrant(refreshToken: string): Promise<void> {
  const cfg = getSupabaseOauthConfig()
  const res = await fetch(SUPABASE_OAUTH.revokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  })
  if (!res.ok && res.status !== 404) {
    throw new OAuthError(`revoke failed (${res.status})`, res.status)
  }
}
