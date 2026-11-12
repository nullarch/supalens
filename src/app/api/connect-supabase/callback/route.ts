import { requestBase } from '@/lib/http/request-base'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import * as Sentry from '@sentry/nextjs'

import { createClient } from '@/utils/supabase/server'
import { isSafeReturnTo, OAUTH_COOKIE } from '@/lib/supabase-oauth/config'
import { exchangeCode } from '@/lib/supabase-oauth/client'
import { connectSupabaseAccount } from '@/lib/supabase-oauth/connect'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { trackServer } from '@/lib/analytics/server'
import { recoveryConnection, reauthorizeConnection, RecoveryError } from '@/lib/supabase-oauth/recovery'
import { isRecoveryId } from '@/lib/alerts/recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function redirectWith(req: Request, params: Record<string, string>, path = '/app/settings/integrations') {
  const url = new URL(path, requestBase(req))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const code = sp.get('code')
  const state = sp.get('state')
  const oauthError = sp.get('error')

  const c = await cookies()
  const expectedState = c.get(OAUTH_COOKIE.state)?.value
  const verifier = c.get(OAUTH_COOKIE.verifier)?.value
  const returnTo = c.get(OAUTH_COOKIE.returnTo)?.value
  const recoveryCookie = c.get(OAUTH_COOKIE.recovery)?.value
  const recoveryPath = isSafeReturnTo(returnTo) ? returnTo : '/app/monitors'
  const recoverFailure = (reason: string) => redirectWith(req, { recovery: reason }, recoveryPath)

  // always clear the handshake cookies
  c.delete(OAUTH_COOKIE.state)
  c.delete(OAUTH_COOKIE.verifier)
  c.delete(OAUTH_COOKIE.returnTo)
  c.delete(OAUTH_COOKIE.recovery)

  if (oauthError) {
    if (recoveryCookie) return recoverFailure(oauthError === 'access_denied' ? 'cancelled' : 'unavailable')
    return redirectWith(req, { error: oauthError })
  }
  // CSRF + PKCE: fail closed
  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    if (recoveryCookie) return recoverFailure('expired')
    return redirectWith(req, { error: 'invalid_state' })
  }

  const supabase = await createClient()
  if (!supabase) return recoveryCookie ? recoverFailure('unavailable') : redirectWith(req, { error: 'supabase_not_configured' })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const login = new URL('/login', requestBase(req))
    const resume = new URL(recoveryCookie ? recoveryPath : '/app/settings/integrations', requestBase(req))
    resume.searchParams.set(recoveryCookie ? 'recovery' : 'error', recoveryCookie ? 'expired' : 'invalid_state')
    login.searchParams.set('next', `${resume.pathname}${resume.search}`)
    return NextResponse.redirect(login)
  }

  if (recoveryCookie) {
    let phase = 'validate'
    try {
      const target = JSON.parse(recoveryCookie)
      if (!isRecoveryId(target.connectionId) || !isRecoveryId(target.orgId) || target.userId !== user.id) return recoverFailure('denied')
      const connection = await recoveryConnection(supabase, user.id, target.connectionId)
      if (connection.org_id !== target.orgId) return recoverFailure('denied')
      phase = 'exchange'
      const tokens = await exchangeCode({ code, codeVerifier: verifier })
      phase = 'persist'
      await reauthorizeConnection(supabase, user.id, target.connectionId, target.orgId, tokens)
      console.info('[supabase-reauthorization]', { phase: 'complete', connectionId: target.connectionId })
      trackServer('supabase_reauthorized', user.id, { org_id: target.orgId, connection_id: target.connectionId })
      return redirectWith(req, { recovery: 'authorized', supabaseConnection: target.connectionId }, recoveryPath)
    } catch (error) {
      // Never place raw provider/token errors in the URL or user-facing message.
      const reason = error instanceof RecoveryError ? error.reason : 'unavailable'
      console.warn('[supabase-reauthorization]', { phase, reason })
      // Never log raw OAuth errors: provider responses may contain credentials.
      trackServer('supabase_reauthorization_failed', user.id, { failure_code: reason })
      return recoverFailure(reason)
    }
  }

  try {
    const orgId = await ensurePrimaryOrg(supabase, user)
    const tokens = await exchangeCode({ code, codeVerifier: verifier })

    const result = await connectSupabaseAccount({
      orgId,
      userId: user.id,
      tokens,
    })

    // Several projects and nothing provisioned yet → the user picks which database to watch
    // first. That choice belongs to the guided flow, so it always lands on /app/setup (which
    // renders the picker from live state and resumes correctly if the tab is closed).
    if (result.needsSelection) {
      trackServer('supabase_connected', user.id, { org_id: orgId, needs_selection: true })
      return redirectWith(req, { select: 'supabase', supabaseConnection: result.connectionId }, '/app/setup')
    }
    trackServer('supabase_connected', user.id, {
      org_id: orgId,
      needs_selection: false,
      projects: result.dataSourceCount,
    })

    const dest = isSafeReturnTo(returnTo) ? returnTo : '/app/settings/integrations'
    // When dispatched, projects import in the background → signal 'connecting' (the UI polls);
    // inline (local-dev) we already know the count → the classic 'connected' banner.
    const params: Record<string, string> = result.dispatched
      ? { connecting: 'supabase' }
      : { connected: 'supabase', projects: String(result.dataSourceCount) }
    params.supabaseConnection = result.connectionId
    // Projects the plan's connection cap deferred (connect never fails on the cap — it truncates).
    if (result.skippedForPlan > 0) params.skipped = String(result.skippedForPlan)
    return redirectWith(req, params, dest)
  } catch (err) {
    console.error('[connect-supabase] callback failed:', err)
    Sentry.captureException(err)
    trackServer('supabase_connect_failed', user.id, { failure_code: 'connect_failed' })
    return redirectWith(req, { error: 'connect_failed' })
  }
}
