// NOT `import 'server-only'` — shared convention with the other paddle modules (config/client/
// webhook-handlers); usage.ts (Trigger-shared) imports this for the paid-period reconcile.
//
// API-verified provisioning WITHOUT webhooks. Every write here derives org billing state from
// server→Paddle API reads (authenticated by the secret API key), never from client-supplied
// data — the same trust model as the webhook, minus the delivery channel. Both paths reuse
// handleSubscriptionEvent/handleTransactionEvent (idempotent snapshot UPSERTs with an
// occurred-at ordering guard), so running webhooks AND sync together is safe.
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/node'

import { requireAdminClient } from '@/utils/supabase/admin'
import { getSubscription, getTransaction, listSubscriptionsByCustomer } from './client'
import {
  handleSubscriptionEvent,
  handleTransactionEvent,
  type PaddleSubscriptionData,
  type PaddleTransactionData,
} from './webhook-handlers'

/** Transaction statuses that mean the checkout money is collected (or settling). */
const SETTLED = new Set(['completed', 'paid'])

/**
 * checkout.completed fires BEFORE Paddle materializes the subscription on the transaction
 * (observed live: subscription_id lands a few seconds later). Poll briefly for the linkage —
 * without it the subscription provisioning silently never runs and the org stays free with
 * nothing stored for reconcile to key on.
 */
const SUB_LINK_POLL_ATTEMPTS = 5
const SUB_LINK_POLL_DELAY_MS = 1200

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Map an API-read subscription to the handler's eventType so cancel semantics apply. */
function eventTypeFor(sub: PaddleSubscriptionData): string {
  return sub.status === 'canceled' ? 'subscription.canceled' : 'subscription.updated'
}

/**
 * Provision from a just-completed checkout, keyed by the transaction id from Paddle.js's
 * `checkout.completed` event. The id is only a LOOKUP KEY — org, plan, and period all come from
 * the Paddle API entities themselves, so a forged or replayed id can only re-apply Paddle's own
 * records. Counters reset only on a genuine period roll (isRenewal inside
 * handleSubscriptionEvent), never merely because this ran again.
 */
export async function syncCheckoutTransaction(
  transactionId: string,
  opts?: {
    /**
     * When set, the checkout's custom_data.org_id must be an org this user belongs to, or
     * nothing is provisioned. custom_data is CLIENT-set at checkout — without this binding,
     * confirmCheckout would happily provision a caller's payment onto any org UUID they typed
     * into a hand-rolled Paddle.Checkout.open. (The webhook path has no caller to bind; its
     * protection is the live-subscription relink guard in handleSubscriptionEvent.)
     */
    requireMembershipOfUserId?: string
    /** test hooks — production callers use the defaults */
    pollAttempts?: number
    pollDelayMs?: number
  },
): Promise<{ ok: boolean; error?: string }> {
  const admin = requireAdminClient()
  let txnRaw = await getTransaction(transactionId)
  if (!txnRaw) return { ok: false, error: 'transaction_not_found' }
  let txn = txnRaw as unknown as PaddleTransactionData
  if (!SETTLED.has(txn.status)) return { ok: false, error: `transaction_${txn.status}` }

  // Wait out the transaction→subscription linkage race (see SUB_LINK_POLL_* above).
  const attempts = opts?.pollAttempts ?? SUB_LINK_POLL_ATTEMPTS
  const delayMs = opts?.pollDelayMs ?? SUB_LINK_POLL_DELAY_MS
  for (let i = 0; i < attempts && !txn.subscription_id; i++) {
    await sleep(delayMs)
    txnRaw = await getTransaction(transactionId)
    if (txnRaw) txn = txnRaw as unknown as PaddleTransactionData
  }

  const subRaw = txn.subscription_id ? await getSubscription(txn.subscription_id) : null
  const sub = subRaw ? (subRaw as unknown as PaddleSubscriptionData) : null

  if (opts?.requireMembershipOfUserId) {
    const orgId = sub?.custom_data?.org_id ?? txn.custom_data?.org_id ?? null
    if (orgId) {
      const { count } = await admin
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('user_id', opts.requireMembershipOfUserId)
      if (!count) {
        Sentry.captureMessage(
          `paddle: confirmCheckout caller ${opts.requireMembershipOfUserId} is not a member of custom_data org ${orgId} (txn ${transactionId}) — refused to provision`,
          { level: 'error' },
        )
        return { ok: false, error: 'forbidden' }
      }
    }
  }

  if (sub) {
    await handleSubscriptionEvent(admin, eventTypeFor(sub), sub, sub.updated_at ?? undefined)
  }
  await handleTransactionEvent(admin, txn)

  if (!sub) {
    // Money is settled but the subscription still isn't linked — the org would silently stay
    // free. handleTransactionEvent above stored the transaction + customer breadcrumbs, so
    // reconcileOrgSubscription self-heals on the next billing-page load / lazy quota reconcile.
    // Tell the caller it's pending (localized as "will be reflected shortly"), and page a human
    // for visibility — this should be rare once the poll window covers Paddle's lag.
    Sentry.captureMessage(
      `paddle: settled checkout ${transactionId} had no subscription after ${attempts} polls — provisioning deferred to reconcile`,
      { level: 'warning' },
    )
    return { ok: false, error: 'transaction_pending' }
  }
  return { ok: true }
}

/**
 * Locate the subscription for an org that has none stored — the self-heal for a checkout
 * whose transaction→subscription linkage outlived the confirm poll (or whose confirmCheckout
 * never ran at all, e.g. the tab closed on the Paddle success screen):
 *   (a) newest stored billing transaction → re-read from Paddle → linkage may exist NOW;
 *   (b) customer breadcrumb → the customer's subscriptions, matched to THIS org via checkout
 *       custom_data (one customer can pay for several orgs — never take an unmatched one).
 */
async function findSubscriptionForOrg(
  admin: SupabaseClient,
  orgId: string,
  customerId: string | null,
): Promise<string | null> {
  const { data: txRows } = await admin
    .from('billing_transactions')
    .select('paddle_transaction_id, paddle_subscription_id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
  const tx = txRows?.[0] as { paddle_transaction_id: string | null; paddle_subscription_id: string | null } | undefined
  if (tx?.paddle_subscription_id) return tx.paddle_subscription_id
  if (tx?.paddle_transaction_id) {
    try {
      const txn = (await getTransaction(tx.paddle_transaction_id)) as { subscription_id?: string | null } | null
      if (txn?.subscription_id) return txn.subscription_id
    } catch {
      // fall through to the customer scan
    }
  }
  if (customerId) {
    try {
      const subs = (await listSubscriptionsByCustomer(customerId)) as Array<{
        id?: string
        custom_data?: { org_id?: string } | null
      }>
      for (const s of subs) {
        if (s?.id && s.custom_data?.org_id === orgId) return s.id
      }
    } catch {
      // no subscriptions found — genuinely nothing to heal
    }
  }
  return null
}

/**
 * Re-read the org's linked subscription from the Paddle API and apply the latest snapshot —
 * covers renewals (period roll → counter reset) and cancellations in webhook-less mode.
 * Called from the billing page (fresh state on view) and the paid-period lazy reconcile in
 * plans/usage.ts. When the org has NO stored subscription link, falls back to the stored
 * transaction / customer breadcrumbs (findSubscriptionForOrg) so a paid-but-unlinked org
 * heals itself instead of staying free forever. Returns false when nothing is found.
 */
export async function reconcileOrgSubscription(orgId: string): Promise<boolean> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('organizations')
    .select('paddle_subscription_id, paddle_customer_id')
    .eq('id', orgId)
    .limit(1)
  const org = data?.[0] as { paddle_subscription_id: string | null; paddle_customer_id: string | null } | undefined
  let subId = org?.paddle_subscription_id ?? null
  if (!subId) {
    subId = await findSubscriptionForOrg(admin, orgId, org?.paddle_customer_id ?? null)
    if (!subId) return false
  }
  const subRaw = await getSubscription(subId)
  if (!subRaw) return false
  const sub = subRaw as unknown as PaddleSubscriptionData
  await handleSubscriptionEvent(admin, eventTypeFor(sub), sub, sub.updated_at ?? undefined)
  return true
}
