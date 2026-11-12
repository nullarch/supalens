import { requireAdminClient } from '@/utils/supabase/admin'
import { authenticatePartner, proxyError } from '@/lib/proxy/auth'
import { rateLimit, clientIpOf, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Partner pull API: one recorded payment (initial or renewal). Accepts our uuid OR the Paddle txn id. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = rateLimit(`proxy-pull:${clientIpOf(req)}`, 120, 60_000)
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSec)

  const admin = requireAdminClient()
  const partner = await authenticatePartner(admin, req)
  if (!partner) return proxyError(401, 'unknown_api_key')

  const { id } = await params
  const SELECT =
    'id, subscription_id, paddle_transaction_id, kind, status, amount_cents, currency, billing_period_starts_at, billing_period_ends_at, billed_at, created_at'
  // uuid → our id; txn_… → Paddle's id (partner-scoped either way)
  let query = admin.from('proxy_transactions').select(SELECT).eq('partner_id', partner.id).limit(1)
  query = id.startsWith('txn_') ? query.eq('paddle_transaction_id', id) : query.eq('id', id)
  const { data } = await query
  const row = data?.[0] as Record<string, unknown> | undefined
  if (!row) return proxyError(404, 'transaction_not_found')

  return Response.json({
    transaction_id: row.id,
    subscription_id: row.subscription_id,
    paddle_transaction_id: row.paddle_transaction_id,
    kind: row.kind,
    status: row.status,
    amount_cents: row.amount_cents,
    currency: row.currency,
    billing_period_starts_at: row.billing_period_starts_at,
    billing_period_ends_at: row.billing_period_ends_at,
    billed_at: row.billed_at,
    created_at: row.created_at,
  })
}
