import { requireAdminClient } from '@/utils/supabase/admin'
import { authenticatePartner, proxyError } from '@/lib/proxy/auth'
import { loadPartnerSubscription } from '@/lib/proxy/api'
import { createPortalSession } from '@/lib/paddle/client'
import { rateLimit, clientIpOf, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Partner API: mint Paddle customer-portal deep links (manage / cancel / update
 * payment method) for the subscription's buyer. URLs are short-lived auto-sign-in
 * links — the partner must request them per click and NEVER cache or embed them.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = rateLimit(`proxy-manage:${clientIpOf(req)}`, 30, 60_000)
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSec)

  const admin = requireAdminClient()
  const partner = await authenticatePartner(admin, req)
  if (!partner) return proxyError(401, 'unknown_api_key')

  const { id } = await params
  const row = await loadPartnerSubscription(admin, partner, id)
  if (!row) return proxyError(404, 'subscription_not_found')
  if (!row.paddle_customer_id) return proxyError(409, 'not_yet_active')

  try {
    const urls = await createPortalSession(
      row.paddle_customer_id,
      row.paddle_subscription_id ? [row.paddle_subscription_id] : undefined,
    )
    return Response.json({
      overview_url: urls.overview,
      cancel_url: urls.cancel ?? null,
      update_payment_url: urls.updatePayment ?? null,
    })
  } catch (err) {
    console.error(`[proxy] portal session failed for ${id}:`, err)
    return proxyError(502, 'paddle_error')
  }
}
