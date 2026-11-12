import { requireAdminClient } from '@/utils/supabase/admin'
import { authenticatePartner, proxyError } from '@/lib/proxy/auth'
import { loadPartnerSubscription, latestTransactionOf, serializeSubscription } from '@/lib/proxy/api'
import { cancelSubscription } from '@/lib/paddle/client'
import { rateLimit, clientIpOf, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CANCELABLE = new Set(['trialing', 'active', 'past_due', 'paused'])

/**
 * Partner API: cancel a subscription. Default effective = next_billing_period
 * (Paddle emits subscription.updated with scheduled_change now, subscription.canceled
 * at period end); 'immediately' emits subscription.canceled right away. The response
 * echoes the CURRENT stored snapshot — authoritative state (and the partner callback)
 * arrives via the webhook relay.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = rateLimit(`proxy-manage:${clientIpOf(req)}`, 30, 60_000)
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSec)

  const admin = requireAdminClient()
  const partner = await authenticatePartner(admin, req)
  if (!partner) return proxyError(401, 'unknown_api_key')

  const { id } = await params
  const row = await loadPartnerSubscription(admin, partner, id)
  if (!row) return proxyError(404, 'subscription_not_found')
  if (!row.paddle_subscription_id) return proxyError(409, 'not_yet_active')
  if (!CANCELABLE.has(row.status)) return proxyError(409, 'not_cancelable')

  let effective: 'next_billing_period' | 'immediately' = 'next_billing_period'
  try {
    const body = (await req.json()) as { effective?: string }
    if (body?.effective === 'immediately') effective = 'immediately'
  } catch {
    // empty body → default
  }

  try {
    await cancelSubscription(row.paddle_subscription_id, effective)
  } catch (err) {
    console.error(`[proxy] cancel failed for ${id}:`, err)
    return proxyError(502, 'paddle_error')
  }

  return Response.json({
    ok: true,
    effective,
    subscription: serializeSubscription(row, await latestTransactionOf(admin, row.id)),
  })
}
