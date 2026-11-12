import { appOrigin } from '@/config/edition'
import { requireAdminClient } from '@/utils/supabase/admin'
import { authenticatePartner, isAllowedReturnUrl, proxyError } from '@/lib/proxy/auth'
import { createCheckoutTransaction } from '@/lib/paddle/client'
import { isPaddleConfigured } from '@/lib/paddle/config'
import { rateLimit, clientIpOf, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP_URL = appOrigin()

interface CheckoutBody {
  sku?: string
  partner_user_id?: string
  partner_order_id?: string
  customer_email?: string
  metadata?: Record<string, unknown>
  success_url?: string
  fail_url?: string
}

/** Statuses that count as "this user already has this subscription" for the duplicate guard. */
const LIVE_STATUSES = ['trialing', 'active', 'past_due', 'paused']

/**
 * Partner API: create a subscription checkout. Server-to-server only (X-API-Key).
 * Mints a proxy_subscriptions row (status 'pending'), creates a Paddle transaction
 * for the SKU's catalog price with the proxy custom_data stamp, and returns the
 * hosted checkout URL. Idempotent on (partner, partner_order_id): a re-POST while
 * still pending returns the same checkout_url; after progress → 409.
 */
export async function POST(req: Request) {
  const ipGate = rateLimit(`proxy-checkout-ip:${clientIpOf(req)}`, 60, 60_000)
  if (!ipGate.allowed) return tooManyRequests(ipGate.retryAfterSec)

  if (!isPaddleConfigured()) return proxyError(503, 'gateway_not_configured')
  const admin = requireAdminClient()

  const partner = await authenticatePartner(admin, req)
  if (!partner) return proxyError(401, 'unknown_api_key')

  const partnerGate = rateLimit(`proxy-checkout:${partner.id}`, 30, 60_000)
  if (!partnerGate.allowed) return tooManyRequests(partnerGate.retryAfterSec)

  let body: CheckoutBody
  try {
    body = (await req.json()) as CheckoutBody
  } catch {
    return proxyError(400, 'invalid_json')
  }

  const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
  const partnerUserId = typeof body.partner_user_id === 'string' ? body.partner_user_id.trim() : ''
  const partnerOrderId = typeof body.partner_order_id === 'string' ? body.partner_order_id.trim() : ''
  if (!sku || sku.length > 64) return proxyError(400, 'invalid_sku')
  if (!partnerUserId || partnerUserId.length > 200) return proxyError(400, 'invalid_partner_user_id')
  if (!partnerOrderId || partnerOrderId.length > 100) return proxyError(400, 'invalid_partner_order_id')
  const customerEmail = typeof body.customer_email === 'string' ? body.customer_email.trim() : null
  if (customerEmail && (customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
    return proxyError(400, 'invalid_customer_email')
  }
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}

  const successUrl = typeof body.success_url === 'string' ? body.success_url : ''
  const failUrl = typeof body.fail_url === 'string' ? body.fail_url : ''
  if (!successUrl || !isAllowedReturnUrl(partner, successUrl)) return proxyError(400, 'success_url_origin_not_allowed')
  if (!failUrl || !isAllowedReturnUrl(partner, failUrl)) return proxyError(400, 'fail_url_origin_not_allowed')

  const { data: productRows } = await admin
    .from('proxy_products')
    .select('id, paddle_price_id, kind')
    .eq('partner_id', partner.id)
    .eq('sku', sku)
    .eq('is_active', true)
    .limit(1)
  const product = productRows?.[0] as { id: string; paddle_price_id: string; kind: string } | undefined
  if (!product) return proxyError(404, 'unknown_sku')
  if (product.kind !== 'subscription') return proxyError(400, 'sku_not_subscription')

  // Idempotency: same partner_order_id → return the pending checkout again; 409 once it progressed.
  const { data: existingRows } = await admin
    .from('proxy_subscriptions')
    .select('id, status, paddle_checkout_txn_id')
    .eq('partner_id', partner.id)
    .eq('partner_order_id', partnerOrderId)
    .limit(1)
  const existing = existingRows?.[0] as { id: string; status: string; paddle_checkout_txn_id: string | null } | undefined
  if (existing) {
    if (existing.status === 'pending' && existing.paddle_checkout_txn_id) {
      return Response.json({
        subscription_id: existing.id,
        checkout_url: checkoutUrlFor(existing.paddle_checkout_txn_id),
        paddle_transaction_id: existing.paddle_checkout_txn_id,
      })
    }
    return proxyError(409, 'order_already_processed')
  }

  // One live subscription per (partner user, product) — mirrors the org relink guard philosophy.
  const { data: liveRows } = await admin
    .from('proxy_subscriptions')
    .select('id')
    .eq('partner_id', partner.id)
    .eq('partner_user_id', partnerUserId)
    .eq('product_id', product.id)
    .in('status', LIVE_STATUSES)
    .limit(1)
  if (liveRows?.length) return proxyError(409, 'already_subscribed')

  const { data: inserted, error: insertErr } = await admin
    .from('proxy_subscriptions')
    .insert({
      partner_id: partner.id,
      product_id: product.id,
      partner_user_id: partnerUserId,
      partner_order_id: partnerOrderId,
      customer_email: customerEmail,
      status: 'pending',
      success_url: successUrl,
      fail_url: failUrl,
      metadata,
    })
    .select('id')
  if (insertErr || !inserted?.length) {
    // 23505 = a concurrent request won the (partner_id, partner_order_id) race — treat as duplicate
    if (insertErr?.code === '23505') return proxyError(409, 'duplicate_partner_order_id')
    console.error('[proxy-checkout] insert failed:', insertErr)
    return proxyError(500, 'db_error')
  }
  const subscriptionId = (inserted[0] as { id: string }).id

  let txn: { id: string; checkoutUrl: string | null }
  try {
    txn = await createCheckoutTransaction({
      priceId: product.paddle_price_id,
      customerEmail,
      // Copied by Paddle onto the subscription and every future transaction — the
      // webhook routes proxy events by proxy_subscription_id (see proxy/webhook-handlers).
      customData: {
        proxy: 1,
        partner_code: partner.code,
        proxy_subscription_id: subscriptionId,
        partner_user_id: partnerUserId,
      },
    })
  } catch (err) {
    // No Paddle transaction was materialized for this order — release the idempotency
    // slot so the partner can retry the same partner_order_id.
    await admin.from('proxy_subscriptions').delete().eq('id', subscriptionId)
    console.error('[proxy-checkout] paddle transaction create failed:', err)
    return proxyError(502, 'paddle_error')
  }

  await admin.from('proxy_subscriptions').update({ paddle_checkout_txn_id: txn.id }).eq('id', subscriptionId)

  return Response.json(
    {
      subscription_id: subscriptionId,
      checkout_url: checkoutUrlFor(txn.id),
      paddle_transaction_id: txn.id,
    },
    { status: 201 },
  )
}

/**
 * Deterministic hosted-checkout URL on OUR page (works in every environment
 * regardless of the dashboard's default-payment-link setting). The page reads
 * _ptxn — the same parameter Paddle's own checkout links use.
 */
function checkoutUrlFor(paddleTransactionId: string): string {
  return `${APP_URL}/proxy/checkout?_ptxn=${encodeURIComponent(paddleTransactionId)}`
}
