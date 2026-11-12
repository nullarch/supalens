import { requestBase } from '@/lib/http/request-base'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import * as Sentry from '@sentry/nextjs'

import { createClient } from '@/utils/supabase/server'
import { getSlackAppConfig, isSafeReturnTo, SLACK_OAUTH_COOKIE } from '@/lib/slack-app/config'
import { connectSlackWorkspace, WorkspaceAlreadyConnectedError } from '@/lib/slack-app/connect'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { trackServer } from '@/lib/analytics/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function redirectWith(req: Request, params: Record<string, string>, path = '/app/settings/integrations') {
  const url = new URL(path, requestBase(req))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/**
 * Slack OAuth v2 callback. Slack redirects here with `code` + the `state` we sent. We:
 *   1. verify `state` (CSRF, fail closed),
 *   2. exchange the code for a bot token + persist the connection (connectSlackWorkspace),
 *   3. redirect back to the integrations page.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const code = sp.get('code')
  const state = sp.get('state')
  const slackError = sp.get('error')

  const c = await cookies()
  const expectedState = c.get(SLACK_OAUTH_COOKIE.state)?.value
  const returnTo = c.get(SLACK_OAUTH_COOKIE.returnTo)?.value
  c.delete(SLACK_OAUTH_COOKIE.state)
  c.delete(SLACK_OAUTH_COOKIE.returnTo)

  if (slackError) return redirectWith(req, { error: slackError })
  if (!state || !expectedState || state !== expectedState) return redirectWith(req, { error: 'invalid_state' })
  if (!code) return redirectWith(req, { error: 'missing_code' })

  const supabase = await createClient()
  if (!supabase) return redirectWith(req, { error: 'supabase_not_configured' })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const login = new URL('/login', requestBase(req))
    login.searchParams.set('next', '/app/settings/integrations')
    return NextResponse.redirect(login)
  }

  try {
    const orgId = await ensurePrimaryOrg(supabase, user)
    // MUST match the redirect_uri the authorize route sent (Slack verifies the pair) —
    // same derivation: explicit env override, else this deployment's own callback URL.
    const redirectUri =
      getSlackAppConfig().redirectUri ?? new URL('/api/connect-slack/callback', requestBase(req)).toString()
    const result = await connectSlackWorkspace({ orgId, userId: user.id, code, redirectUri })
    trackServer('slack_connected', user.id, { org_id: orgId })
    const dest = isSafeReturnTo(returnTo) ? returnTo : '/app/settings/integrations'
    return redirectWith(req, { connected: 'slack', team: result.teamName ?? result.teamId }, dest)
  } catch (err) {
    if (err instanceof WorkspaceAlreadyConnectedError) {
      trackServer('slack_connect_failed', user.id, { failure_code: 'workspace_already_connected' })
      return redirectWith(req, { error: 'workspace_already_connected' })
    }
    console.error('[connect-slack] callback failed:', err)
    Sentry.captureException(err)
    trackServer('slack_connect_failed', user.id, { failure_code: 'connect_failed' })
    return redirectWith(req, { error: 'connect_failed' })
  }
}
