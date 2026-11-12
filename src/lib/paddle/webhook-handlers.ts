// NOT `import 'server-only'` — provisions org billing state from Paddle webhook
// events. All writes via the service-role admin client (billing columns are
// service-role managed; the guard trigger allows service_role).
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/node'

import { planForPriceId } from './config'
import type { PlanTier } from '@/lib/plans/limits'
import { overageEnabled, computeOverageQueries, overageCostUsd } from '@/lib/plans/overage'
import { createOverageCharge } from './client'
import { recordPaddlePayment, recordPaddleRefund } from '@/lib/content-agent/events'
import { sendPaymentToHub, sendRefundToHub, type HubDelivery } from '@/lib/event-hub/events'

export interface PaddleSubscriptionData {
  id: string
  status: string
  customer_id: string
  custom_data?: { org_id?: string } | null
  items?: Array<{ price?: { id?: string } | null }> | null
  current_billing_period?: { starts_at?: string; ends_at?: string } | null
  scheduled_change?: { action?: string; effective_at?: string } | null
  /** The subscription entity's own timestamp — the ordering watermark (see handleSubscriptionEvent). */
  updated_at?: string | null
}

export interface PaddleTransactionData {
  id: string
  subscription_id?: string | null
  customer_id?: string | null
  status: string
  custom_data?: { org_id?: string } | null
  currency_code?: string | null
  details?: { totals?: { grand_total?: string | null } | null } | null
  billed_at?: string | null
  created_at?: string | null
}

async function orgBySubscription(admin: SupabaseClient, subId: string): Promise<string | null> {
  const { data } = await admin.from('organizations').select('id').eq('paddle_subscription_id', subId).limit(1)
  return (data?.[0] as { id: string } | undefined)?.id ?? null
}

function planFromItems(items: PaddleSubscriptionData['items']): PlanTier | null {
  for (const it of items ?? []) {
    const pid = it?.price?.id
    if (pid) {
      const m = planForPriceId(pid)
      if (m) return m.plan
    }
  }
  return null
}

/**
 * Provision org billing from a subscription.* event. Idempotent (UPSERT of state),
 * ordering-safe (writes the latest snapshot, not a delta). custom_data.org_id (set
 * at checkout) is the primary org link; the stored subscription id is the fallback.
 */
export async function handleSubscriptionEvent(
  admin: SupabaseClient,
  eventType: string,
  data: PaddleSubscriptionData,
  occurredAt?: string,
): Promise<void> {
  const orgId = data.custom_data?.org_id ?? (data.id ? await orgBySubscription(admin, data.id) : null)
  if (!orgId) {
    console.warn(`[paddle] no org for subscription ${data.id} (${eventType})`)
    // money may have been received but access can't be granted → needs a human, not a silent warn.
    Sentry.captureMessage(`paddle: no org for subscription ${data.id} (${eventType}) — payment may be unprovisioned`, {
      level: 'error',
    })
    return
  }

  // Read the org's current state once (for the ordering guard + renewal detection).
  const { data: orgRows } = await admin
    .from('organizations')
    .select(
      'plan, subscription_status, current_period_starts_at, billing_event_at, current_period_query_count, paddle_customer_id, paddle_subscription_id',
    )
    .eq('id', orgId)
    .limit(1)
  const orgState = orgRows?.[0] as
    | {
        plan: string | null
        subscription_status: string | null
        current_period_starts_at: string | null
        billing_event_at: string | null
        current_period_query_count: number | null
        paddle_customer_id: string | null
        paddle_subscription_id: string | null
      }
    | undefined
  // Ordering guard: a retried/older event must not resurrect a canceled plan or rewind usage.
  // Watermark = the subscription ENTITY's updated_at on both delivery paths (the webhook payload
  // carries the entity; sync.ts reads it from the API), so webhook + reconcile compare the same
  // clock. Event occurred_at is only a fallback for payloads without the entity timestamp.
  const watermark = data.updated_at ?? occurredAt ?? null
  if (watermark && orgState?.billing_event_at && new Date(watermark) <= new Date(orgState.billing_event_at)) {
    return
  }

  // Tenant-linkage guard: custom_data.org_id is set CLIENT-side at checkout (a determined user can
  // call Paddle.Checkout.open directly with someone else's org UUID). If this org already has a
  // DIFFERENT live subscription, never clobber that linkage — the victim's portal would start
  // opening the attacker's customer and the real subscription link would be lost. A legit
  // re-subscribe (after cancel) has a canceled/absent stored status and passes.
  const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused'])
  if (
    orgState?.paddle_subscription_id &&
    orgState.paddle_subscription_id !== data.id &&
    orgState.subscription_status != null &&
    LIVE_STATUSES.has(orgState.subscription_status)
  ) {
    console.warn(`[paddle] refused to relink org ${orgId}: live sub ${orgState.paddle_subscription_id} ≠ event sub ${data.id}`)
    Sentry.captureMessage(
      `paddle: refused to relink org ${orgId} from live subscription ${orgState.paddle_subscription_id} to ${data.id} (${eventType}) — possible custom_data abuse or double-subscribe`,
      { level: 'error' },
    )
    return
  }

  const patch: Record<string, unknown> = {
    subscription_status: data.status,
    paddle_customer_id: data.customer_id,
    paddle_subscription_id: data.id,
    scheduled_change: data.scheduled_change ?? null,
  }
  const starts = data.current_billing_period?.starts_at
  const ends = data.current_billing_period?.ends_at
  if (starts) patch.current_period_starts_at = starts
  if (ends) patch.current_period_ends_at = ends

  if (eventType === 'subscription.canceled') {
    // access ends → drop to free (metered caps apply again). Clear the dead subscription link
    // (else reconcile polls it forever) and any leftover scheduled_change; keep the customer id
    // so the portal + payment history still work.
    patch.plan = 'free'
    patch.subscription_status = 'canceled'
    patch.paddle_subscription_id = null
    patch.scheduled_change = null
  } else {
    const plan = planFromItems(data.items)
    if (plan) patch.plan = plan
    else if (data.items?.length) {
      // A paid subscription whose price id maps to NO tier (yearly variant missing from env,
      // price recreated in the Paddle dashboard, catalog drift): money is collected but the org
      // silently keeps its old plan. Provision what we can, but page a human.
      const ids = data.items.map((it) => it?.price?.id).filter(Boolean).join(', ')
      console.warn(`[paddle] no plan mapped for price(s) ${ids} on subscription ${data.id}`)
      Sentry.captureMessage(
        `paddle: no plan mapped for price(s) ${ids} (subscription ${data.id}, org ${orgId}, ${eventType}) — paid subscription may be unprovisioned`,
        { level: 'error' },
      )
    }
  }

  // Reset the metered window on creation/activation or a genuine period roll (renewal),
  // NOT on a mid-cycle plan change (same period start).
  const storedStart = orgState?.current_period_starts_at ?? null
  const isRenewal = Boolean(starts && starts !== storedStart)

  // Atomically CLAIM the renewal so only ONE execution resets counters + bills overage. The
  // webhook (subscription.updated) and the lazy reconcile in checkUsageQuota race at exactly
  // renewal time: both read the OLD period start and both compute isRenewal=true. A conditional
  // UPDATE guarded on the period start we just read (compare-and-swap) is atomic under Postgres
  // row locks — the loser's WHERE no longer matches and affects 0 rows, so it must NOT charge.
  let wonRenewalClaim = false
  if (isRenewal) {
    let claim = admin
      .from('organizations')
      .update({ current_period_starts_at: starts, current_period_query_count: 0, current_period_token_count: 0 })
      .eq('id', orgId)
    claim = storedStart === null ? claim.is('current_period_starts_at', null) : claim.eq('current_period_starts_at', storedStart)
    const { data: claimed } = await claim.select('id')
    wonRenewalClaim = (claimed?.length ?? 0) > 0
  }

  // Usage-based overage: on a genuine renewal, bill the ENDING period's excess BEFORE the counter
  // resets. Only the execution that WON the CAS claim charges (else double-billing). GATED —
  // overageEnabled() (flag + positive rate + billing configured) makes this a full no-op by
  // default, so no money moves until it's deliberately turned on + validated.
  if (isRenewal && wonRenewalClaim && overageEnabled()) {
    const overQ = computeOverageQueries(orgState?.plan ?? 'free', orgState?.current_period_query_count ?? 0)
    const customerId = orgState?.paddle_customer_id ?? data.customer_id
    if (overQ > 0 && customerId) {
      try {
        await createOverageCharge(customerId, overageCostUsd(overQ), `Usage overage — ${overQ} queries`)
      } catch (err) {
        // never break provisioning on a charge failure; surface it (overage NOT collected this cycle).
        console.error(`[paddle] overage charge failed for org ${orgId}:`, err)
        Sentry.captureException(err, { tags: { area: 'overage' }, extra: { orgId, overQ } })
      }
    }
  }

  // The renewal counter-reset is done atomically by the CAS claim above (exactly once). Here we
  // only reset on creation/activation, which is not a race with reconcile.
  if (eventType === 'subscription.created' || eventType === 'subscription.activated') {
    patch.current_period_query_count = 0
    patch.current_period_token_count = 0
  }

  patch.billing_event_at = watermark

  await admin.from('organizations').update(patch).eq('id', orgId)

  // Dunning: first transition INTO past_due → notify org owners/admins (best-effort,
  // never fails the webhook; the email module never throws).
  if (data.status === 'past_due' && orgState?.subscription_status !== 'past_due') {
    const [{ recipientsFor, orgNameOf }, { sendPaymentFailedEmail }, { resolveOrgLocale }] = await Promise.all([
      import('@/lib/alerts/runner'),
      import('@/lib/email/billing'),
      import('@/lib/i18n/resolve-locale'),
    ])
    await sendPaymentFailedEmail({
      to: await recipientsFor(orgId),
      orgName: await orgNameOf(orgId),
      plan: (patch.plan as string | undefined) ?? orgState?.plan ?? 'free',
      locale: await resolveOrgLocale(orgId),
    })
  }
}

export interface PaddleAdjustmentData {
  id: string
  action?: string | null // refund | credit | chargeback | …
  status?: string | null // pending_approval | approved | rejected (chargebacks skip approval)
  transaction_id?: string | null
  /** read by the content-agent refund event (amount in minor units, like transaction totals) */
  currency_code?: string | null
  totals?: { total?: string | null; currency_code?: string | null } | null
  created_at?: string | null
  updated_at?: string | null
}

/**
 * Reflect an approved refund/chargeback on the stored transaction row so the billing-page
 * history stops showing the payment as settled. Adjustments never change plan/access here —
 * any access change arrives as its own subscription.* event.
 *
 * Returns 'retry' when the webhook should answer non-2xx so Paddle redelivers (see the route).
 */
export async function handleAdjustmentEvent(admin: SupabaseClient, data: PaddleAdjustmentData): Promise<HubDelivery> {
  if (!data.transaction_id) return 'done'
  const refundLike = data.action === 'refund' || data.action === 'chargeback'
  const approved = data.status == null || data.status === 'approved'
  if (!refundLike || !approved) return 'done'
  const { error: writeErr } = await admin
    .from('billing_transactions')
    .update({ status: data.action === 'chargeback' ? 'chargeback' : 'refunded' })
    .eq('paddle_transaction_id', data.transaction_id)
  // content-agent `refund` (org transactions only — resolved via billing_transactions, so a proxy
  // adjustment records nothing). Env-gated no-op; never throws.
  await recordPaddleRefund({ adj: data, admin })
  // The hub gets a refund only once the write above has committed; a failed write is redelivered.
  if (writeErr) {
    console.error(`[paddle] adjustment ${data.id} write failed:`, writeErr)
    Sentry.captureException(writeErr, { tags: { area: 'paddle-billing-write' }, extra: { adjustmentId: data.id } })
    return 'retry'
  }
  return sendRefundToHub(admin, data)
}

/**
 * Record a completed transaction for the billing-page history. `sendToHub` is the webhook's: it can
 * ask Paddle to redeliver, and its transaction.completed payload is final. The API sync can run on a
 * transaction whose subscription isn't linked yet, which would classify the same payment differently.
 *
 * Returns 'retry' when the webhook should answer non-2xx so Paddle redelivers (see the route).
 */
export async function handleTransactionEvent(
  admin: SupabaseClient,
  data: PaddleTransactionData,
  opts?: { sendToHub?: boolean },
): Promise<HubDelivery> {
  const orgId = data.custom_data?.org_id ?? (data.subscription_id ? await orgBySubscription(admin, data.subscription_id) : null)
  if (!orgId) return 'done'
  const grand = data.details?.totals?.grand_total
  const amountCents = grand != null ? Number.parseInt(grand, 10) : null
  // This can run again long after the first delivery (Paddle redelivers while the hub is down, the
  // API sync re-reads Paddle), by which time the payment may be refunded. Replaying it must not undo that.
  const { data: storedRows, error: readErr } = await admin
    .from('billing_transactions')
    .select('status')
    .eq('paddle_transaction_id', data.id)
    .limit(1)
  const storedStatus = (storedRows?.[0] as { status: string | null } | undefined)?.status
  const reversed = storedStatus === 'refunded' || storedStatus === 'chargeback'
  const writeErr =
    readErr ??
    (
      await admin.from('billing_transactions').upsert(
        {
          org_id: orgId,
          paddle_transaction_id: data.id,
          paddle_subscription_id: data.subscription_id ?? null,
          status: reversed ? storedStatus : data.status,
          amount_cents: amountCents != null && Number.isFinite(amountCents) ? amountCents : null,
          currency: data.currency_code ?? null,
          billed_at: data.billed_at ?? null,
        },
        { onConflict: 'paddle_transaction_id' },
      )
    ).error

  // Customer breadcrumb: checkout.completed can land BEFORE Paddle materializes the
  // subscription (see paddle/sync.ts), so the subscription handler may not have run yet.
  // Storing the customer id lets reconcile later find this org's subscription by customer.
  // Conditional (only when unset) so an established linkage is never clobbered.
  if (data.customer_id) {
    await admin
      .from('organizations')
      .update({ paddle_customer_id: data.customer_id })
      .eq('id', orgId)
      .is('paddle_customer_id', null)
  }

  // content-agent `subscription_payment` — shared by the webhook AND the API-verified sync, keyed on
  // the Paddle transaction id so both paths collapse to one event. Env-gated no-op; never throws.
  await recordPaddlePayment({ orgId, txn: data, admin })

  // The hub gets a payment only once the write above has committed. A redelivery can fix a failed
  // write, except a foreign-key failure: custom_data.org_id is client-set and may name no org at all.
  if (writeErr) {
    console.error(`[paddle] transaction ${data.id} write failed:`, writeErr)
    Sentry.captureException(writeErr, { tags: { area: 'paddle-billing-write' }, extra: { transactionId: data.id } })
    return writeErr.code === '23503' ? 'done' : 'retry'
  }
  return opts?.sendToHub ? sendPaymentToHub(admin, orgId, data) : 'done'
}
