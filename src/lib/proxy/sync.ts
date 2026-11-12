// NOT `import 'server-only'` — mirrors lib/paddle/sync.ts.
//
// API-verified self-heal for the proxy gateway: re-read the Paddle entities and
// apply the same snapshot handlers the webhook uses. Called from the pull API when
// a subscription still looks 'pending' (late/lost webhook), so a partner's
// success-page pull converges without the webhook ever arriving. Sync-originated
// callback enqueues use deterministic dedupe keys (state timestamps), and the
// transition guards compare against the stored status — so webhook + sync running
// together never double-fire a callback for the same transition.
import type { SupabaseClient } from '@supabase/supabase-js'

import { getSubscription, getTransaction } from '@/lib/paddle/client'
import type { PaddleSubscriptionData } from '@/lib/paddle/webhook-handlers'
import { handleProxySubscriptionEvent, handleProxyTransactionEvent } from './webhook-handlers'

const SETTLED = new Set(['completed', 'paid'])

function eventTypeFor(sub: PaddleSubscriptionData): string {
  return sub.status === 'canceled' ? 'subscription.canceled' : 'subscription.updated'
}

/**
 * Re-read a proxy subscription's Paddle state and apply it. Returns true when a
 * subscription snapshot was applied (the row is now authoritative), false when
 * the checkout genuinely hasn't settled/linked yet.
 */
export async function syncProxySubscription(
  admin: SupabaseClient,
  row: { id: string; paddle_subscription_id: string | null; paddle_checkout_txn_id: string | null },
): Promise<boolean> {
  let paddleSubId = row.paddle_subscription_id

  if (!paddleSubId && row.paddle_checkout_txn_id) {
    const txnRaw = await getTransaction(row.paddle_checkout_txn_id)
    if (!txnRaw) return false
    const txn = txnRaw as { id: string; status: string; subscription_id?: string | null }
    if (!SETTLED.has(txn.status)) return false
    await handleProxyTransactionEvent(
      admin,
      txnRaw as never,
      `sync:txn:${txn.id}`, // deterministic — repeated pulls of the same state enqueue once
    )
    paddleSubId = txn.subscription_id ?? null
  }

  if (!paddleSubId) return false
  const subRaw = await getSubscription(paddleSubId)
  if (!subRaw) return false
  const sub = subRaw as unknown as PaddleSubscriptionData
  await handleProxySubscriptionEvent(
    admin,
    eventTypeFor(sub),
    sub,
    `sync:sub:${sub.id}:${sub.updated_at ?? ''}`,
    sub.updated_at ?? undefined,
  )
  return true
}
