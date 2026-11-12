import { requestBase } from '@/lib/http/request-base'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

import { createClient } from '@/utils/supabase/server'
import { getGithubAppConfig, installUrl, isSafeReturnTo, GH_OAUTH_COOKIE } from '@/lib/github-app/config'
import { trackServer } from '@/lib/analytics/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Start the GitHub App connect flow: mint a CSRF `state`, stash it in an httpOnly
 * cookie, and redirect the user to the App install URL. GitHub echoes `state` back
 * to the callback (Setup URL) with `installation_id` + `setup_action`.
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  if (!supabase) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 })
  }

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
    cfg = getGithubAppConfig()
  } catch {
    // No GitHub App registered (the usual self-hosted case): back to Connections, not a raw error body.
    return NextResponse.redirect(new URL('/app/sources', requestBase(req)))
  }

  const state = b64url(randomBytes(16))
  const c = await cookies()
  const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  c.set(GH_OAUTH_COOKIE.state, state, opts)

  const returnTo = new URL(req.url).searchParams.get('returnTo')
  if (isSafeReturnTo(returnTo)) {
    c.set(GH_OAUTH_COOKIE.returnTo, returnTo, opts)
  }

  trackServer('github_oauth_started', user.id)

  return NextResponse.redirect(installUrl(cfg.slug, state))
}
