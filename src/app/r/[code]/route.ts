import { appOrigin } from '@/config/edition'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { REF_COOKIE, REF_COOKIE_MAX_AGE, clientIpFrom, hashVisitorIp, isRefCode, recordRefClick } from '@/lib/attribution/service'
import { contentAgentConfigured } from '@/lib/content-agent/config'
import {
  CA_VARIANT_COOKIE,
  CA_VARIANT_COOKIE_MAX_AGE,
  captureFromSearchParams,
  decodeVariantCookie,
  encodeVariantCookie,
} from '@/lib/content-agent/logic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * content-agent attribution: its tracked links append a saved-variant UUID (`ca_variant`, plus
 * `utm_id` for campaigns). Keep the FIRST one in the sl_cav cookie; org creation turns it into a
 * content_agent_attribution row. Strict UUID validation, so junk never reaches the cookie (or the
 * DB), and a complete no-op unless CONTENT_AGENT_TRACKING_* is configured. Independent of whether
 * the ref code itself matched — the variant is the attribution.
 */
async function captureContentAgentVariant(url: URL, res: NextResponse): Promise<void> {
  if (!contentAgentConfigured()) return
  const capture = captureFromSearchParams(url.searchParams)
  if (!capture) return
  try {
    if (decodeVariantCookie((await cookies()).get(CA_VARIANT_COOKIE)?.value)) return // first touch wins
    res.cookies.set(CA_VARIANT_COOKIE, encodeVariantCookie(capture), {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: CA_VARIANT_COOKIE_MAX_AGE,
    })
  } catch {
    /* attribution is best-effort — never break the redirect */
  }
}

/**
 * Tracked-link redirect: /r/<code>[?to=/path] → records the click and 302s to the
 * app, setting a first-touch attribution cookie so a later signup can be tied back to the campaign
 * (joined in ensurePrimaryOrg / createOrg). Public + fast; tracking is best-effort and never blocks the redirect.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const url = new URL(req.url)

  // `to` is an INTERNAL path only — never an absolute URL — so this can't be an open redirect.
  const toParam = url.searchParams.get('to')
  const path = toParam && toParam.startsWith('/') && !toParam.startsWith('//') ? toParam : '/'
  const dest = `${appOrigin()}${path}`

  if (!isRefCode(code)) {
    const bare = NextResponse.redirect(dest, 302)
    await captureContentAgentVariant(url, bare)
    return bare
  }

  const { matched } = await recordRefClick({
    refCode: code,
    visitorHash: hashVisitorIp(clientIpFrom(req.headers)),
    userAgent: req.headers.get('user-agent'),
    referer: req.headers.get('referer'),
  })

  const res = NextResponse.redirect(dest, 302)
  if (matched) {
    // First-touch: only set if not already present, so the earliest tracked link that brought
    // the visitor in keeps the eventual signup credit (a later click on another link
    // doesn't steal attribution).
    const existing = (await cookies()).get(REF_COOKIE)?.value
    if (!existing || !isRefCode(existing)) {
      res.cookies.set(REF_COOKIE, code, {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: REF_COOKIE_MAX_AGE,
      })
    }
  }
  await captureContentAgentVariant(url, res)
  return res
}
