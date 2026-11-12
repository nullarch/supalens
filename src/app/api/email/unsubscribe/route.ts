import { NextRequest, NextResponse } from 'next/server'

import { verifyUnsubToken, type UnsubKind } from '@/lib/email/unsubscribe'
import { createAdminClient } from '@/utils/supabase/admin'
import { getServerTranslator, type ServerT } from '@/lib/i18n/server-translator'
import { resolveUserLocale } from '@/lib/i18n/resolve-locale'
import { rateLimit, clientIpOf, tooManyRequests } from '@/lib/rate-limit'

/**
 * One-click email unsubscribe (RFC 8058 / Gmail-Yahoo bulk-sender requirement).
 *
 * - POST = the actual unsubscribe. Mailbox providers fire it directly from the
 *   List-Unsubscribe-Post header (no session, so auth is the signed HMAC token),
 *   and the GET landing page's button posts here too.
 * - GET  = a tiny confirmation page. It does NOT unsubscribe on its own —
 *   link-scanning proxies prefetch GETs and would silently unsubscribe people.
 *
 * Unauthenticated by design (token-authenticated) → rate-limited per IP (§6).
 * Copy renders in the RECIPIENT's stored locale (the token carries their user id);
 * an invalid token falls back to English (the product default).
 */

export const dynamic = 'force-dynamic'

const KIND_COLUMN: Record<UnsubKind, string> = {
  digest: 'email_digest_opt_out',
  alert: 'email_alert_opt_out',
  lifecycle: 'email_lifecycle_opt_out',
}

function page(body: string, title: string): NextResponse {
  return new NextResponse(
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f6f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:440px;margin:80px auto;background:#fff;border:1px solid #e8e2d8;border-radius:14px;padding:36px;text-align:center;">
    <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9a9284;margin:0 0 16px;">Supalens</p>
    ${body}
  </div>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

function expiredPage(t: ServerT): NextResponse {
  return page(
    `<h1 style="font-size:18px;color:#1f1b16;margin:0 0 8px;">${t('expiredTitle')}</h1>
     <p style="font-size:14px;color:#6b6459;margin:0;">${t('expiredBody')}</p>`,
    t('confirmTitle'),
  )
}

async function applyUnsubscribe(token: string | null): Promise<'ok' | 'invalid' | 'unavailable'> {
  if (!token) return 'invalid'
  const payload = verifyUnsubToken(token)
  if (!payload) return 'invalid'
  const admin = createAdminClient()
  if (!admin) return 'unavailable'
  const { error } = await admin
    .from('organization_members')
    .update({ [KIND_COLUMN[payload.kind]]: true })
    .eq('org_id', payload.orgId)
    .eq('user_id', payload.userId)
  if (error) {
    console.error('[unsubscribe] update failed:', error)
    return 'unavailable'
  }
  return 'ok'
}

/** One-click unsubscribe (mailbox providers + the landing page's button). */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`unsub:${clientIpOf(req)}`, 30, 60_000)
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec)

  const token = req.nextUrl.searchParams.get('token')
  const payload = token ? verifyUnsubToken(token) : null
  const t = await getServerTranslator(payload ? await resolveUserLocale(payload.userId) : null, 'emailUnsubscribe')
  const result = await applyUnsubscribe(token)
  if (result === 'invalid') return expiredPage(t)
  if (result === 'unavailable') {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
  return page(
    `<h1 style="font-size:18px;color:#1f1b16;margin:0 0 8px;">${t('unsubscribedTitle')}</h1>
     <p style="font-size:14px;color:#6b6459;margin:0;">${t('unsubscribedBody')}</p>`,
    t('unsubscribedTitle'),
  )
}

/** Confirmation landing page — the button POSTs back with the same token. */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`unsub:${clientIpOf(req)}`, 30, 60_000)
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec)

  const token = req.nextUrl.searchParams.get('token')
  const payload = token ? verifyUnsubToken(token) : null
  const t = await getServerTranslator(payload ? await resolveUserLocale(payload.userId) : null, 'emailUnsubscribe')
  if (!payload) return expiredPage(t)

  const action = `/api/email/unsubscribe?token=${encodeURIComponent(token as string)}`
  const what = t(`kinds.${payload.kind}`)
  return page(
    `<h1 style="font-size:18px;color:#1f1b16;margin:0 0 8px;">${t('confirmTitle')}</h1>
     <p style="font-size:14px;color:#6b6459;margin:0 0 24px;">${t('confirmBody', { what })}</p>
     <form method="post" action="${action}">
       <button type="submit" style="background:#c96f4a;color:#fff;border:0;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;cursor:pointer;">${t('button')}</button>
     </form>`,
    t('confirmTitle'),
  )
}
