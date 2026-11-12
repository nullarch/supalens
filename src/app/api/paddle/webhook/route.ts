import * as Sentry from '@sentry/nextjs'

import { requireAdminClient } from '@/utils/supabase/admin'
import { getPaddleConfig } from '@/lib/paddle/config'
import { verifyPaddleSignature } from '@/lib/paddle/webhook-verify'
import {
  handleSubscriptionEvent,
  handleTransactionEvent,
  handleAdjustmentEvent,
  type PaddleSubscriptionData,
  type PaddleTransactionData,
  type PaddleAdjustmentData,
} from '@/lib/paddle/webhook-handlers'
import type { HubDelivery } from '@/lib/event-hub/events'
import {
  isProxyCustomData,
  handleProxySubscriptionEvent,
  handleProxyTransactionEvent,
  handleProxyAdjustmentEvent,
} from '@/lib/proxy/webhook-handlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Paddle Billing webhook. Verifies the signature over the RAW body, de-dupes on
 * event_id (Paddle delivers at-least-once and can retry / arrive out of order), and
 * provisions org billing state. Webhooks are the SOURCE OF TRUTH — the client
 * checkout callback never grants access. Responds fast; work is just DB upserts.
 */
export async function POST(req: Request) {
  const raw = await req.text() // RAW body — verify before any JSON parse
  const sig = req.headers.get('paddle-signature') ?? ''

  let cfg
  try {
    cfg = getPaddleConfig()
  } catch {
    return Response.json({ error: 'paddle_not_configured' }, { status: 500 })
  }
  // Webhook-less deployments (no PADDLE_WEBHOOK_SECRET) provision via paddle/sync.ts instead;
  // an unverifiable delivery must never be processed.
  if (!cfg.webhookSecret) {
    return Response.json({ error: 'webhook_secret_not_configured' }, { status: 503 })
  }
  if (!verifyPaddleSignature(cfg.webhookSecret, raw, sig)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let evt: { event_id?: string; event_type?: string; occurred_at?: string; data?: unknown }
  try {
    evt = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const eventId = evt.event_id
  const eventType = evt.event_type
  if (!eventId || !eventType) return Response.json({ error: 'missing_fields' }, { status: 400 })

  // This Paddle account is shared with other services of the same company, and every destination receives the events of ALL of them. Tellscene tags
  // each transaction it creates with custom_data.app = "tellscene" (Paddle copies it to the subscription and to every renewal). None of that is this
  // app's business: without this the subscription handler raises a "no org for subscription" Sentry error for each of them.
  if ((evt.data as { custom_data?: { app?: unknown } } | undefined)?.custom_data?.app === 'tellscene') {
    return Response.json({ ok: true, ignored: 'other_service' })
  }

  const admin = requireAdminClient()

  // Idempotency, ATOMIC (a SELECT-then-upsert let two concurrent deliveries of the same event
  // both process — GitHub/Slack use the same insert-claim pattern). The unique event_id INSERT is
  // the claim; on conflict, re-claim ONLY a row that is retryable: a prior attempt that failed
  // ('invalid') or one stuck at 'received' past the staleness window (crashed mid-processing).
  // 'processed' rows and a fresh in-flight 'received' row stay skipped.
  const { error: claimErr } = await admin
    .from('paddle_webhook_events')
    .insert({ event_id: eventId, event_type: eventType, occurred_at: evt.occurred_at ?? null, payload: evt, status: 'received' })
  if (claimErr) {
    if (claimErr.code !== '23505') {
      console.error(`[paddle-webhook] idempotency insert failed for ${eventId}:`, claimErr)
      Sentry.captureException(claimErr, { tags: { eventType, eventId } })
      return Response.json({ error: 'ingest_failed' }, { status: 500 })
    }
    // Two AND-only conditional updates, NOT one `.or()` filter — PostgREST rejects logical
    // operators on UPDATE (42703; verified against prod 2026-07-16).
    const staleCutoff = new Date(Date.now() - 5 * 60_000).toISOString()
    const reclaimPatch = { status: 'received', received_at: new Date().toISOString(), payload: evt }
    const invalid = await admin
      .from('paddle_webhook_events')
      .update(reclaimPatch)
      .eq('event_id', eventId)
      .eq('status', 'invalid')
      .select('event_id')
    let reclaimed = Boolean(invalid.data?.length)
    if (!reclaimed) {
      const stale = await admin
        .from('paddle_webhook_events')
        .update(reclaimPatch)
        .eq('event_id', eventId)
        .eq('status', 'received')
        .lt('received_at', staleCutoff)
        .select('event_id')
      reclaimed = Boolean(stale.data?.length)
    }
    if (!reclaimed) {
      return Response.json({ ok: true, duplicate: true })
    }
  }

  // Proxy-gateway routing: checkout stamps custom_data onto the transaction, Paddle
  // copies it to the subscription and every transaction it bills, so proxy traffic
  // self-identifies. Non-proxy events flow through the original org path unchanged.
  const isProxy = isProxyCustomData((evt.data as { custom_data?: unknown } | undefined)?.custom_data)

  try {
    let delivery: HubDelivery = 'done'
    if (eventType.startsWith('subscription.')) {
      if (isProxy) await handleProxySubscriptionEvent(admin, eventType, evt.data as PaddleSubscriptionData, eventId, evt.occurred_at)
      else await handleSubscriptionEvent(admin, eventType, evt.data as PaddleSubscriptionData, evt.occurred_at)
    } else if (eventType === 'transaction.completed') {
      if (isProxy) await handleProxyTransactionEvent(admin, evt.data as PaddleTransactionData, eventId)
      else delivery = await handleTransactionEvent(admin, evt.data as PaddleTransactionData, { sendToHub: true })
    } else if (eventType.startsWith('adjustment.')) {
      // Adjustments carry no custom_data — run BOTH handlers; paddle_transaction_id
      // lives in exactly one of billing_transactions / proxy_transactions, so exactly
      // one acts (the other no-ops).
      await handleProxyAdjustmentEvent(admin, evt.data as PaddleAdjustmentData, eventId)
      delivery = await handleAdjustmentEvent(admin, evt.data as PaddleAdjustmentData)
    }
    // The billing write is committed but the event hub (or that write) needs another try. Marking
    // the row 'invalid' is what lets the redelivery past the claim above; 'processed' or 'received'
    // would answer it as a duplicate. Replaying the handlers is safe: they are idempotent, and the
    // transaction handler leaves a refunded row alone.
    if (delivery === 'retry') {
      await admin.from('paddle_webhook_events').update({ status: 'invalid' }).eq('event_id', eventId)
      return Response.json({ error: 'delivery_pending' }, { status: 503 })
    }
    await admin.from('paddle_webhook_events').update({ status: 'processed' }).eq('event_id', eventId)
  } catch (err) {
    console.error(`[paddle-webhook] ${eventType} ${eventId} failed:`, err)
    Sentry.captureException(err, { tags: { eventType, eventId } })
    await admin.from('paddle_webhook_events').update({ status: 'invalid' }).eq('event_id', eventId)
    // 5xx so Paddle retries (at-least-once) instead of treating a transient failure as delivered.
    return Response.json({ error: 'processing_failed' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
