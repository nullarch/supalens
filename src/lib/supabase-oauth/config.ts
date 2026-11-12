// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev
// process-revocations task (plain Node bundle), same convention as utils/supabase/admin.ts.
/** Supabase Management API OAuth endpoints (the "Build a Supabase Integration" flow). */
export const SUPABASE_OAUTH = {
  authorizeUrl: 'https://api.supabase.com/v1/oauth/authorize',
  tokenUrl: 'https://api.supabase.com/v1/oauth/token',
  revokeUrl: 'https://api.supabase.com/v1/oauth/revoke',
  managementBase: 'https://api.supabase.com/v1',
} as const

export interface SupabaseOauthAppConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function getSupabaseOauthConfig(): SupabaseOauthAppConfig {
  const clientId = process.env.SUPA_CONNECT_CLIENT_ID
  const clientSecret = process.env.SUPA_CONNECT_CLIENT_SECRET
  const redirectUri = process.env.SUPA_CONNECT_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Supabase OAuth app is not configured. Set SUPA_CONNECT_CLIENT_ID, SUPA_CONNECT_CLIENT_SECRET, SUPA_CONNECT_REDIRECT_URI.'
    )
  }
  return { clientId, clientSecret, redirectUri }
}

/** Whether "Connect Supabase" (the Management API OAuth app) is registered for this install.
 *  UI must hide the connect buttons when it is not — a self-hosted install usually connects
 *  databases directly instead. */
export function supabaseConnectConfigured(): boolean {
  return Boolean(
    process.env.SUPA_CONNECT_CLIENT_ID && process.env.SUPA_CONNECT_CLIENT_SECRET && process.env.SUPA_CONNECT_REDIRECT_URI,
  )
}

/** HTTP Basic auth header value for the token/revoke endpoints. */
export function basicAuthHeader(cfg: SupabaseOauthAppConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')
}

export const OAUTH_COOKIE = {
  state: 'sb_oauth_state',
  verifier: 'sb_oauth_verifier',
  returnTo: 'sb_oauth_return_to',
  recovery: 'sb_oauth_recovery',
} as const

/**
 * Only same-origin, path-only redirect targets are allowed. Rejects protocol-relative
 * (`//evil.com`) and backslash (`/\evil.com`) forms that `new URL()` resolves off-origin.
 */
export { isSafeReturnTo } from '@/lib/http/safe-return-to'
