// NOT `import 'server-only'` — mirrors lib/paddle/webhook-handlers.ts conventions.
// Provisions proxy_subscriptions state from Paddle webhook events that carry the
// proxy custom_data stamp, and enqueues signed partner callbacks on transitions.
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/node'

import type { PaddleSubscriptionData, PaddleTransactionData, PaddleAdjustmentData } from '@/lib/paddle/webhook-handlers'
import { enqueueCallback, type ProxyCallbackEvent } from './callbacks'

interface ProxyCustomData {
  proxy?: unknown
  partner_code?: string
  proxy_subscription_id?: string
  partner_user_id?: string
}

/** Route test: does this event's custom_data carry the proxy stamp (set at checkout)? */
export function isProxyCustomData(customData: unknown): boolean {
  return Boolean(customData && typeof (customData as ProxyCustomData).proxy_subscription_id === 'string')
}

/** proxy_subscriptions row + the joined partner/product context every handler needs. */
interface ProxySubRow {
  id: string
  partner_id: string
  product_id: string
  partner_user_id: string
  partner_order_id: string | null
  status: string
  paddle_subscription_id: string | null
  paddle_customer_id: string | null
  paddle_checkout_txn_id: string | null
  current_period_starts_at: string | null
  current_period_ends_at: string | null
  scheduled_change: Record<string, unknown> | null
  canceled_at: string | null
  billing_event_at: string | null
  metadata: Record<string, unknown>
  proxy_partners: {
    code: string
    callback_url: string | null
    api_secret: string
    is_test: boolean
  } | null
  proxy_products: { sku: string } | null
}

const SUB_SELECT =
  'id, partner_id, product_id, partner_user_id, partner_order_id, status, paddle_subscription_id, paddle_customer_id, paddle_checkout_txn_id, current_period_starts_at, current_period_ends_at, scheduled_change, canceled_at, billing_event_at, metadata, proxy_partners (code, callback_url, api_secret, is_test), proxy_products (sku)'

function first<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

async function findSubscription(
  admin: SupabaseClient,
  customData: unknown,
  paddleSubscriptionId?: string | null,
): Promise<ProxySubRow | null> {
  const proxyId = (customData as ProxyCustomData | null)?.proxy_subscription_id
  if (proxyId) {
    const { data } = await admin.from('proxy_subscriptions').select(SUB_SELECT).eq('id', proxyId).limit(1)
    if (data?.[0]) return normalize(data[0])
  }
  if (paddleSubscriptionId) {
    const { data } = await admin
      .from('proxy_subscriptions')
      .select(SUB_SELECT)
      .eq('paddle_subscription_id', paddleSubscriptionId)
      .limit(1)
    if (data?.[0]) return normalize(data[0])
  }
  return null
}

// PostgREST types embedded relations as object-or-array depending on cardinality inference.
function normalize(raw: unknown): ProxySubRow {
  const row = raw as Record<string, unknown>
  return {
    ...(row as unknown as ProxySubRow),
    proxy_partners: first(row.proxy_partners as ProxySubRow['proxy_partners'] | ProxySubRow['proxy_partners'][]),
    proxy_products: first(row.proxy_products as ProxySubRow['proxy_products'] | ProxySubRow['proxy_products'][]),
  }
}

/** Statuses in which the buyer holds (or held until dunning resolves) entitlement. */
const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'paused'])

interface EnqueueCtx {
  row: ProxySubRow
  eventId: string
  snapshot: Record<string, unknown>
  transaction?: Record<string, unknown>
}

async function enqueueTransition(admin: SupabaseClient, event: ProxyCallbackEvent, ctx: EnqueueCtx): Promise<void> {
  const partner = ctx.row.proxy_partners
  if (!partner) return
  await enqueueCallback(admin, {
    partnerId: ctx.row.partner_id,
    subscriptionId: ctx.row.id,
    callbackUrl: partner.callback_url,
    apiSecret: partner.api_secret,
    isTest: partner.is_test,
    event,
    dedupeKey: ctx.eventId,
    payload: {
      event,
      subscription_id: ctx.row.id,
      partner_order_id: ctx.row.partner_order_id,
      partner_user_id: ctx.row.partner_user_id,
      sku: ctx.row.proxy_products?.sku ?? null,
      ...ctx.snapshot,
      ...(ctx.transaction ? { transaction: ctx.transaction } : {}),
      metadata: ctx.row.metadata ?? {},
    },
  })
}

/**
 * Provision proxy subscription state from a subscription.* event. Snapshot-upsert
 * guarded by the billing_event_at watermark (same semantics as the org handler:
 * a retried/older event must never rewind status). Callbacks fire on TRANSITIONS
 * (compared against the stored status), deduped per Paddle event id.
 */
export async function handleProxySubscriptionEvent(
  admin: SupabaseClient,
  eventType: string,
  data: PaddleSubscriptionData,
  eventId: string,
  occurredAt?: string,
): Promise<void> {
  const row = await findSubscription(admin, data.custom_data, data.id)
  if (!row) {
    console.warn(`[proxy] no proxy subscription for ${data.id} (${eventType})`)
    Sentry.captureMessage(`proxy: no subscription row for ${data.id} (${eventType}) — payment may be unprovisioned`, {
      level: 'error',
    })
    return
  }

  const watermark = data.updated_at ?? occurredAt ?? null
  if (watermark && row.billing_event_at && new Date(watermark) <= new Date(row.billing_event_at)) {
    return
  }

  const patch: Record<string, unknown> = {
    status: data.status,
    paddle_subscription_id: data.id,
    paddle_customer_id: data.customer_id,
    scheduled_change: data.scheduled_change ?? null,
    billing_event_at: watermark,
    updated_at: new Date().toISOString(),
  }
  const starts = data.current_billing_period?.starts_at
  const ends = data.current_billing_period?.ends_at
  if (starts) patch.current_period_starts_at = starts
  if (ends) patch.current_period_ends_at = ends
  if (eventType === 'subscription.canceled') {
    patch.status = 'canceled'
    patch.canceled_at = occurredAt ?? new Date().toISOString()
    patch.scheduled_change = null
  }

  await admin.from('proxy_subscriptions').update(patch).eq('id', row.id)

  const snapshot = {
    status: patch.status as string,
    current_period_starts_at: (patch.current_period_starts_at as string | undefined) ?? row.current_period_starts_at,
    current_period_ends_at: (patch.current_period_ends_at as string | undefined) ?? row.current_period_ends_at,
    scheduled_change: patch.scheduled_change ?? null,
    canceled_at: (patch.canceled_at as string | undefined) ?? row.canceled_at,
  }

  // Transition-driven callbacks (each Paddle event maps to at most one).
  const becameLive = LIVE_STATUSES.has(String(data.status)) && !LIVE_STATUSES.has(row.status)
  if (eventType === 'subscription.canceled' && row.status !== 'canceled') {
    await enqueueTransition(admin, 'proxy.subscription.canceled', { row, eventId, snapshot })
  } else if (data.status === 'past_due' && row.status !== 'past_due') {
    await enqueueTransition(admin, 'proxy.subscription.past_due', { row, eventId, snapshot })
  } else if (becameLive) {
    await enqueueTransition(admin, 'proxy.subscription.activated', { row, eventId, snapshot })
  }
}

/** Paddle transaction payloads carry the billing period the payment covers. */
interface ProxyTransactionData extends PaddleTransactionData {
  billing_period?: { starts_at?: string; ends_at?: string } | null
}

/**
 * Record a completed proxy transaction (initial checkout payment or a renewal).
 * Renewals enqueue proxy.subscription.renewed — the signal partners extend
 * entitlement periods from (covers scheduled renewals AND past_due recovery).
 */
export async function handleProxyTransactionEvent(
  admin: SupabaseClient,
  data: ProxyTransactionData,
  eventId: string,
): Promise<void> {
  const row = await findSubscription(admin, data.custom_data, data.subscription_id)
  if (!row) {
    console.warn(`[proxy] no proxy subscription for transaction ${data.id}`)
    Sentry.captureMessage(`proxy: no subscription row for transaction ${data.id} — payment may be unprovisioned`, {
      level: 'error',
    })
    return
  }

  const grand = data.details?.totals?.grand_total
  const amountCents = grand != null ? Number.parseInt(grand, 10) : null
  const kind = data.id === row.paddle_checkout_txn_id ? 'initial' : 'renewal'
  const txnRecord = {
    partner_id: row.partner_id,
    subscription_id: row.id,
    paddle_transaction_id: data.id,
    paddle_subscription_id: data.subscription_id ?? null,
    kind,
    status: 'completed',
    amount_cents: amountCents != null && Number.isFinite(amountCents) ? amountCents : null,
    currency: data.currency_code ?? null,
    billing_period_starts_at: data.billing_period?.starts_at ?? null,
    billing_period_ends_at: data.billing_period?.ends_at ?? null,
    billed_at: data.billed_at ?? null,
  }
  await admin.from('proxy_transactions').upsert(txnRecord, { onConflict: 'paddle_transaction_id' })

  // Customer/subscription breadcrumbs — only when unset, never clobber (cf. org handler).
  if (data.customer_id) {
    await admin
      .from('proxy_subscriptions')
      .update({ paddle_customer_id: data.customer_id })
      .eq('id', row.id)
      .is('paddle_customer_id', null)
  }
  if (data.subscription_id) {
    await admin
      .from('proxy_subscriptions')
      .update({ paddle_subscription_id: data.subscription_id })
      .eq('id', row.id)
      .is('paddle_subscription_id', null)
  }

  if (kind === 'renewal') {
    await enqueueTransition(admin, 'proxy.subscription.renewed', {
      row,
      eventId,
      snapshot: {
        status: row.status,
        current_period_starts_at: data.billing_period?.starts_at ?? row.current_period_starts_at,
        current_period_ends_at: data.billing_period?.ends_at ?? null,
      },
      transaction: {
        id: data.id,
        amount_cents: txnRecord.amount_cents,
        currency: txnRecord.currency,
        billed_at: txnRecord.billed_at,
      },
    })
  }
}

/**
 * Reflect an approved refund/chargeback on the stored proxy transaction and relay it.
 * Adjustments carry NO custom_data, so this no-ops for non-proxy transactions (the
 * org-side handler picks those up — paddle_transaction_id matches exactly one table).
 * Access changes still arrive only via subscription.* events.
 */
export async function handleProxyAdjustmentEvent(
  admin: SupabaseClient,
  data: PaddleAdjustmentData,
  eventId: string,
): Promise<void> {
  if (!data.transaction_id) return
  const refundLike = data.action === 'refund' || data.action === 'chargeback'
  const approved = data.status == null || data.status === 'approved'
  if (!refundLike || !approved) return

  const { data: txnRows } = await admin
    .from('proxy_transactions')
    .select('id, subscription_id, paddle_transaction_id, amount_cents, currency, billed_at')
    .eq('paddle_transaction_id', data.transaction_id)
    .limit(1)
  const txn = txnRows?.[0] as
    | { id: string; subscription_id: string | null; paddle_transaction_id: string; amount_cents: number | null; currency: string | null; billed_at: string | null }
    | undefined
  if (!txn) return // not proxy traffic

  const newStatus = data.action === 'chargeback' ? 'chargeback' : 'refunded'
  await admin.from('proxy_transactions').update({ status: newStatus }).eq('id', txn.id)

  if (!txn.subscription_id) return
  const { data: subRows } = await admin
    .from('proxy_subscriptions')
    .select(SUB_SELECT)
    .eq('id', txn.subscription_id)
    .limit(1)
  if (!subRows?.[0]) return
  const row = normalize(subRows[0])

  await enqueueTransition(admin, 'proxy.subscription.refunded', {
    row,
    eventId,
    snapshot: { status: row.status },
    transaction: {
      id: txn.paddle_transaction_id,
      status: newStatus,
      amount_cents: txn.amount_cents,
      currency: txn.currency,
      billed_at: txn.billed_at,
    },
  })
}
