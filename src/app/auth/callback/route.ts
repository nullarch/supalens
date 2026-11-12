import { requestBase } from '@/lib/http/request-base'
import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

import { createClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function safeNext(n: string | null): string {
  if (!n || !n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\')) {
    return '/app/ask'
  }
  // Reject control chars + backslash: the WHATWG URL parser strips tab/LF/CR
  // and would collapse `/%09/evil.com` into a protocol-relative `//evil.com`.
  if (/[\u0000-\u001f\u007f\\]/.test(n)) return '/app/ask'
  return n
}

/**
 * OAuth / magic-link redirect target. Exchanges the `code` (PKCE) — or verifies a
 * `token_hash` OTP — for a session (cookies set by the SSR server client), then redirects
 * to the validated `next` (default /app/ask).
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const next = safeNext(url.searchParams.get('next'))

  const supabase = await createClient()
  if (!supabase) return NextResponse.redirect(new URL('/login?error=not_configured', requestBase(req)))

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return NextResponse.redirect(new URL('/login?error=auth_failed', requestBase(req)))
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (error) return NextResponse.redirect(new URL('/login?error=auth_failed', requestBase(req)))
  } else {
    return NextResponse.redirect(new URL('/login?error=missing_code', requestBase(req)))
  }

  return NextResponse.redirect(new URL(next, requestBase(req)))
}
