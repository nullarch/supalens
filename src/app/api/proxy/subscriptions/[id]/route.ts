import { requireAdminClient } from '@/utils/supabase/admin'
import { authenticatePartner, proxyError } from '@/lib/proxy/auth'
import { loadPartnerSubscription, latestTransactionOf, serializeSubscription } from '@/lib/proxy/api'
import { syncProxySubscription } from '@/lib/proxy/sync'
import { rateLimit, clientIpOf, tooManyRequests } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Partner pull API: current subscription state. The other half of push+pull —
 * partners hit this from their success page (webhook may not have landed yet) and
 * as a reconcile fallback. A row still 'pending' triggers an API-verified self-heal
 * (lib/proxy/sync.ts) so the pull converges even if the webhook is late or lost.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = rateLimit(`proxy-pull:${clientIpOf(req)}`, 120, 60_000)
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSec)

  const admin = requireAdminClient()
  const partner = await authenticatePartner(admin, req)
  if (!partner) return proxyError(401, 'unknown_api_key')

  const { id } = await params
  let row = await loadPartnerSubscription(admin, partner, id)
  if (!row) return proxyError(404, 'subscription_not_found')

  if (row.status === 'pending') {
    try {
      const healed = await syncProxySubscription(admin, row)
      if (healed) row = (await loadPartnerSubscription(admin, partner, id)) ?? row
    } catch (err) {
      // pull must still answer with the stored state
      console.warn(`[proxy] pending self-heal failed for ${id}:`, err)
    }
  }

  return Response.json(serializeSubscription(row, await latestTransactionOf(admin, row.id)))
}
