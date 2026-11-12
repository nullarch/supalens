import { requestBase } from '@/lib/http/request-base'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { createClient } from '@/utils/supabase/server'
import { getSupabaseOauthConfig, isSafeReturnTo, OAUTH_COOKIE, SUPABASE_OAUTH } from '@/lib/supabase-oauth/config'
import { challenge, newState, newVerifier } from '@/lib/supabase-oauth/pkce'
import { trackServer } from '@/lib/analytics/server'
import { recoveryConnection, RecoveryError } from '@/lib/supabase-oauth/recovery'
import { isRecoveryId } from '@/lib/alerts/recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = await createClient()
  const requestUrl = new URL(req.url)
  const connectionId = requestUrl.searchParams.get('connectionId')
  const requestedReturn = requestUrl.searchParams.get('returnTo')
  const recoveryReturn = isSafeReturnTo(requestedReturn) ? requestedReturn : '/app/monitors'
  const recoveryFailure = (reason: string) => {
    const dest = new URL(recoveryReturn, requestBase(req)); dest.searchParams.set('recovery', reason)
    return NextResponse.redirect(dest)
  }
  if (!supabase) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 })
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const login = new URL('/login', requestBase(req))
    login.searchParams.set('next', connectionId ? recoveryReturn : '/app/settings/integrations')
    return NextResponse.redirect(login)
  }

  let recovery: { connectionId: string; orgId: string; userId: string } | null = null
  if (connectionId !== null) {
    if (!isRecoveryId(connectionId)) return recoveryFailure('unavailable')
    try {
      const target = await recoveryConnection(supabase, user.id, connectionId)
      recovery = { connectionId: target.id, orgId: target.org_id, userId: user.id }
    } catch (error) { return recoveryFailure(error instanceof RecoveryError ? error.reason : 'unavailable') }
  }

  let cfg
  try {
    cfg = getSupabaseOauthConfig()
  } catch {
    if (recovery) return recoveryFailure('unavailable')
    // No OAuth app registered (the usual self-hosted case): send the user to the direct
    // connection form instead of a raw error body.
    return NextResponse.redirect(new URL('/app/sources?connect=postgres', requestBase(req)))
  }

  const verifier = newVerifier()
  const state = newState()

  const authorize = new URL(SUPABASE_OAUTH.authorizeUrl)
  authorize.searchParams.set('client_id', cfg.clientId)
  authorize.searchParams.set('redirect_uri', cfg.redirectUri)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('code_challenge', challenge(verifier))
  authorize.searchParams.set('code_challenge_method', 'S256')

  const c = await cookies()
  const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  c.set(OAUTH_COOKIE.state, state, opts)
  c.set(OAUTH_COOKIE.verifier, verifier, opts) // secret — httpOnly cookie only
  if (recovery) c.set(OAUTH_COOKIE.recovery, JSON.stringify(recovery), opts)
  else c.delete(OAUTH_COOKIE.recovery)

  const returnTo = new URL(req.url).searchParams.get('returnTo')
  if (isSafeReturnTo(returnTo)) {
    c.set(OAUTH_COOKIE.returnTo, returnTo, opts)
  } else c.delete(OAUTH_COOKIE.returnTo)

  // Funnel: the user is leaving for Supabase. The matching `supabase_connected` fires in the
  // callback, so the drop-off between the two is the OAuth abandonment rate.
  trackServer('supabase_oauth_started', user.id)

  return NextResponse.redirect(authorize)
}
