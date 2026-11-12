import { requestBase } from '@/lib/http/request-base'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import * as Sentry from '@sentry/nextjs'

import { createClient } from '@/utils/supabase/server'
import { isSafeReturnTo, GH_OAUTH_COOKIE } from '@/lib/github-app/config'
import { connectGithubInstallation, InstallationClaimedByAnotherOrgError } from '@/lib/github-app/connect'
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
 * GitHub App Setup URL / callback. GitHub redirects here after install with
 * `installation_id`, `setup_action`, and the `state` we sent. We:
 *   1. verify `state` (CSRF, fail closed),
 *   2. server-verify the installation_id (in connectGithubInstallation, via App JWT),
 *   3. persist the connection + repositories.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const installationIdRaw = sp.get('installation_id')
  const state = sp.get('state')
  const ghError = sp.get('error')
  // sp.get('setup_action') is 'install' | 'update' | 'request' — informational for now.

  const c = await cookies()
  const expectedState = c.get(GH_OAUTH_COOKIE.state)?.value
  const returnTo = c.get(GH_OAUTH_COOKIE.returnTo)?.value

  // always clear the handshake cookies
  c.delete(GH_OAUTH_COOKIE.state)
  c.delete(GH_OAUTH_COOKIE.returnTo)

  if (ghError) {
    return redirectWith(req, { error: ghError })
  }

  // CSRF: GitHub echoes the `state` we sent to installations/new. Fail closed.
  // (If state echo proves unreliable, switch the connect start to the user-authorization
  //  flow — see docs/github.md §0.1.)
  if (!state || !expectedState || state !== expectedState) {
    return redirectWith(req, { error: 'invalid_state' })
  }

  const installationId = installationIdRaw ? Number(installationIdRaw) : NaN
  if (!Number.isFinite(installationId)) {
    return redirectWith(req, { error: 'missing_installation' })
  }

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
    const result = await connectGithubInstallation({
      orgId,
      userId: user.id,
      installationId,
    })

    trackServer('github_connected', user.id, { org_id: orgId, repos: result.repoCount })
    const dest = isSafeReturnTo(returnTo) ? returnTo : '/app/settings/integrations'
    return redirectWith(req, { connected: 'github', repos: String(result.repoCount) }, dest)
  } catch (err) {
    // The installation belongs to another org — a claim/enumeration attempt, not a system fault.
    // Surface a distinct error and do NOT report to Sentry (expected, user-triggerable).
    if (err instanceof InstallationClaimedByAnotherOrgError) {
      trackServer('github_connect_failed', user.id, { failure_code: 'installation_claimed' })
      return redirectWith(req, { error: 'installation_claimed' })
    }
    console.error('[connect-github] callback failed:', err)
    Sentry.captureException(err)
    trackServer('github_connect_failed', user.id, { failure_code: 'connect_failed' })
    return redirectWith(req, { error: 'connect_failed' })
  }
}
