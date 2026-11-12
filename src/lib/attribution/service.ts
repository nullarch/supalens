// Web-server only (the /r click route + ensurePrimaryOrg/createOrg attribution); NOT imported by
// any trigger/* task, so `import 'server-only'` is safe here (unlike the Trigger-shared email/oauth
// modules). Uses the untyped service-role admin client: the tables are service_role-write.
import 'server-only'

import { createHmac } from 'crypto'

import { createAdminClient } from '@/utils/supabase/admin'
import { isRefCode } from './logic'

export { isRefCode } from './logic'

/** First-touch attribution cookie: the code of the tracked link a visitor clicked. */
export const REF_COOKIE = 'sl_ref'
export const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

/** Privacy-preserving visitor key — HMAC(ip), never a raw IP (mirrors hashDemoIp). */
export function hashVisitorIp(ip: string): string {
  const key = process.env.DEMO_IP_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'supalens-ref'
  return createHmac('sha256', key).update(ip).digest('hex').slice(0, 32)
}

/** First hop of x-forwarded-for, else x-real-ip, else a shared bucket. Only trustworthy behind a
 *  proxy that overwrites the header (see docs/self-hosting.md). */
export function clientIpFrom(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

interface ClickInput {
  refCode: string
  visitorHash: string
  userAgent?: string | null
  referer?: string | null
}

/**
 * Record a tracked-link click. Best-effort — a tracking failure must never break the redirect, so
 * this swallows errors and returns whether the code belongs to a live campaign (so the caller only
 * sets the attribution cookie for a real code). Campaign stats read outreach_clicks by ref_code.
 */
export async function recordRefClick(input: ClickInput): Promise<{ matched: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { matched: false }
  try {
    const { data: campaignRows } = await admin
      .from('outreach_campaigns')
      .select('id')
      .eq('code', input.refCode)
      .is('deleted_at', null)
      .limit(1)
    const campaign = campaignRows?.[0] as { id: string } | undefined

    await admin.from('outreach_clicks').insert({
      ref_code: input.refCode,
      lead_id: null,
      visitor_hash: input.visitorHash,
      user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      referer: input.referer ? input.referer.slice(0, 500) : null,
    })
    return { matched: Boolean(campaign) }
  } catch {
    return { matched: false }
  }
}

/**
 * Attribute a signup to the campaign whose tracked link the user clicked (from the first-touch
 * cookie). Called best-effort from ensurePrimaryOrg (a new user's first workspace) and createOrg
 * (a later one) — never throws, never affects org creation. First touch only: a campaign is
 * credited at most once per org and once per user (unique indexes; a duplicate insert is a no-op).
 */
export async function recordRefConversion(args: {
  refCode: string
  userId: string
  orgId: string
}): Promise<void> {
  if (!isRefCode(args.refCode)) return
  const admin = createAdminClient()
  if (!admin) return
  try {
    const { data: campaignRows } = await admin
      .from('outreach_campaigns')
      .select('id')
      .eq('code', args.refCode)
      .is('deleted_at', null)
      .limit(1)
    const campaign = campaignRows?.[0] as { id: string } | undefined
    if (!campaign) return // unknown / archived code
    // A unique violation (23505 — org or user already credited) comes back as `error`, not a
    // throw; ignoring it IS the first-touch rule.
    await admin
      .from('outreach_campaign_conversions')
      .insert({ campaign_id: campaign.id, user_id: args.userId, org_id: args.orgId })
  } catch {
    /* best-effort — attribution must never break signup */
  }
}
