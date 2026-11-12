// NOT `import 'server-only'`: this module is shared with the Trigger.dev runtime
// (the messenger-answer task reads it to post replies), a plain Node bundle where
// the server-only guard throws. It reads SLACK_* server env (never exposed to the
// browser). Same convention as github-app/config.ts and utils/supabase/admin.ts.

/** Slack OAuth v2 + Web API endpoints. */
export const SLACK = {
  apiBase: 'https://slack.com/api',
  oauthAuthorizeUrl: 'https://slack.com/oauth/v2/authorize',
  oauthTokenUrl: 'https://slack.com/api/oauth.v2.access',
} as const

/**
 * Bot scopes requested at install. Kept minimal (least privilege):
 *  - app_mentions:read — receive `@supalens …` mentions (Phase 2 events)
 *  - chat:write        — post answers + alert notifications back
 *  - channels:read / groups:read — list channels for the alert-channel picker
 */
export const SLACK_BOT_SCOPES = ['app_mentions:read', 'chat:write', 'channels:read', 'groups:read'] as const

export interface SlackAppConfig {
  clientId: string
  clientSecret: string
  /** Verifies inbound Events API request signatures (v0 HMAC). HOST secret — never per-tenant. */
  signingSecret: string
  redirectUri?: string
}

export function getSlackAppConfig(): SlackAppConfig {
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!clientId || !clientSecret || !signingSecret) {
    throw new Error(
      'Slack App is not configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET.'
    )
  }
  return { clientId, clientSecret, signingSecret, redirectUri: process.env.SLACK_REDIRECT_URI }
}

/** True when the Slack App env is present (gates the connect UI/routes, like billingActive()). */
export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET && process.env.SLACK_SIGNING_SECRET)
}

/** The OAuth authorize URL the user is sent to. Slack echoes `state` back to the redirect_uri. */
export function authorizeUrl(clientId: string, state: string, redirectUri?: string): string {
  const u = new URL(SLACK.oauthAuthorizeUrl)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('scope', SLACK_BOT_SCOPES.join(','))
  u.searchParams.set('state', state)
  if (redirectUri) u.searchParams.set('redirect_uri', redirectUri)
  return u.toString()
}

export const SLACK_OAUTH_COOKIE = {
  state: 'slack_oauth_state',
  returnTo: 'slack_oauth_return_to',
} as const

export { isSafeReturnTo } from '@/lib/http/safe-return-to'
