import { requestBase } from '@/lib/http/request-base'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

import { createClient } from '@/utils/supabase/server'
import { getSlackAppConfig, authorizeUrl, isSafeReturnTo, SLACK_OAUTH_COOKIE } from '@/lib/slack-app/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Start the Slack connect flow: mint a CSRF `state`, stash it in an httpOnly cookie,
 * and redirect to Slack's OAuth v2 authorize URL. Slack echoes `state` back to the
 * callback along with the `code` we exchange for a bot token.
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  if (!supabase) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const login = new URL('/login', requestBase(req))
    login.searchParams.set('next', '/app/settings/integrations')
    return NextResponse.redirect(login)
  }

  let cfg
  try {
    cfg = getSlackAppConfig()
  } catch {
    return NextResponse.json({ error: 'slack_app_not_configured' }, { status: 500 })
  }

  const state = b64url(randomBytes(16))
  const c = await cookies()
  const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  c.set(SLACK_OAUTH_COOKIE.state, state, opts)

  const returnTo = new URL(req.url).searchParams.get('returnTo')
  if (isSafeReturnTo(returnTo)) c.set(SLACK_OAUTH_COOKIE.returnTo, returnTo, opts)

  const redirectUri = cfg.redirectUri ?? new URL('/api/connect-slack/callback', requestBase(req)).toString()
  return NextResponse.redirect(authorizeUrl(cfg.clientId, state, redirectUri))
}
