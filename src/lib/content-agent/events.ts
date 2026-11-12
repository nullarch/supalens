// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev runtime
// (bootstrap-supabase-projects records own_db_connected; the Paddle sync reached via
// plans/usage.ts records payments). Same convention as utils/supabase/admin.ts; @sentry/node, not
// @sentry/nextjs, for the same reason.
//
// The enqueue half of the content-agent tracking outbox. Every function here is best-effort and
// NEVER throws — a tracking failure must not break signup, a data-source connect, or Paddle
// provisioning — and is a complete no-op unless CONTENT_AGENT_TRACKING_URL/TOKEN are set.
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/node'

import { createAdminClient } from '@/utils/supabase/admin'
import { contentAgentConfigured } from './config'
import {
  anonymousIdForOrg,
  buildEvent,
  decodeVariantCookie,
  paymentEventFromTransaction,
  refundEventFromAdjustment,
  type EventInput,
  type PaddleAdjustmentLike,
  type PaddleTransactionLike,
} from './logic'

type Admin = SupabaseClient

function report(where: string, err: unknown): void {
  console.warn(`[content-agent] ${where} failed:`, err)
  Sentry.captureException(err, { level: 'warning', tags: { area: 'content-agent', where } })
}

/**
 * HMAC key for the per-org anonymousId. SUPABASE_SERVICE_ROLE_KEY is deliberately the ONLY source:
 * events are enqueued from both runtimes (Vercel + Trigger.dev) and that secret is on both, so the
 * id is identical wherever the event originates (DEMO_IP_SALT, preferred by hashVisitorIp, is not
 * guaranteed on the Trigger host).
 */
function anonKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

async function readAttribution(
  admin: Admin,
  orgId: string,
): Promise<{ variant_id: string; campaign_id: string | null } | null> {
  const { data, error } = await admin
    .from('content_agent_attribution')
    .select('variant_id, campaign_id')
    .eq('org_id', orgId)
    .limit(1)
  if (error) throw error
  return (data?.[0] as { variant_id: string; campaign_id: string | null } | undefined) ?? null
}

export interface EnqueueInput {
  orgId: string
  eventId: string
  name: string
  occurredAt: string | Date
  value?: number | null
  currency?: string | null
}

/**
 * Persist the FINAL event JSON to the outbox (delivery is the Trigger cron's job). Stamps the
 * org's first-touch variant/campaign when it has one (omitted otherwise) and its anonymousId.
 * Insert-or-ignore on event_id: the first enqueue wins, so a replayed trigger (webhook redelivery,
 * sync after webhook, a second connect) can never re-mint the id or change the payload — the
 * ingress would 400 a reused id with changed data. Returns whether a row was attempted.
 */
export async function enqueueContentAgentEvent(input: EnqueueInput, opts?: { admin?: Admin }): Promise<boolean> {
  if (!contentAgentConfigured()) return false
  const admin = opts?.admin ?? createAdminClient()
  if (!admin) return false
  try {
    const attribution = await readAttribution(admin, input.orgId)
    const key = anonKey()
    const eventInput: EventInput = {
      eventId: input.eventId,
      name: input.name,
      occurredAt: input.occurredAt,
      variantId: attribution?.variant_id ?? null,
      campaignId: attribution?.campaign_id ?? null,
      anonymousId: key ? anonymousIdForOrg(input.orgId, key) : null,
      value: input.value ?? null,
      currency: input.currency ?? null,
    }
    const event = buildEvent(eventInput)
    if (!event) {
      console.warn(`[content-agent] invalid event skipped: ${input.name} ${input.eventId}`)
      return false
    }
    const { error } = await admin
      .from('content_agent_outbox')
      .upsert(
        { event_id: event.eventId, name: event.name, org_id: input.orgId, payload: event },
        { onConflict: 'event_id', ignoreDuplicates: true },
      )
    if (error) throw error
    return true
  } catch (err) {
    report(`enqueue ${input.name}`, err)
    return false
  }
}

/**
 * A NEW org was created (ensurePrimaryOrg's first workspace, or createOrg): persist its first-touch
 * attribution from the sl_cav cookie value (if any; insert-or-ignore on org_id), then enqueue
 * `signup` (eventId `signup:<orgId>`) — attribution first, so the signup event carries the variant.
 */
export async function recordContentAgentOrgCreated(args: {
  orgId: string
  cookieValue?: string | null
  admin?: Admin
}): Promise<void> {
  if (!contentAgentConfigured()) return
  const admin = args.admin ?? createAdminClient()
  if (!admin) return
  const capture = decodeVariantCookie(args.cookieValue)
  if (capture) {
    try {
      const { error } = await admin.from('content_agent_attribution').upsert(
        {
          org_id: args.orgId,
          variant_id: capture.variantId,
          campaign_id: capture.campaignId,
          captured_at: capture.capturedAt,
        },
        { onConflict: 'org_id', ignoreDuplicates: true },
      )
      if (error) throw error
    } catch (err) {
      report('attribution', err)
    }
  }
  await enqueueContentAgentEvent(
    { orgId: args.orgId, eventId: `signup:${args.orgId}`, name: 'signup', occurredAt: new Date() },
    { admin },
  )
}

/**
 * A data source just became usable (registered / minted active). Enqueue `own_db_connected` only
 * when it is the org's FIRST own (non-demo) source ever to connect — no other row, live or
 * soft-deleted, has a last_connected_at — so orgs that connected before this shipped stay silent.
 * eventId `own_db_connected:<orgId>` dedupes the rest (e.g. a multi-project OAuth bootstrap).
 */
export async function recordOwnDbConnected(args: { orgId: string; dataSourceId: string; admin?: Admin }): Promise<void> {
  if (!contentAgentConfigured()) return
  const admin = args.admin ?? createAdminClient()
  if (!admin) return
  try {
    const { data, error } = await admin
      .from('data_sources')
      .select('id')
      .eq('org_id', args.orgId)
      .eq('is_demo', false)
      .neq('id', args.dataSourceId)
      .not('last_connected_at', 'is', null)
      .limit(1)
    if (error) throw error
    if ((data?.length ?? 0) > 0) return
  } catch (err) {
    report('own_db_connected lookup', err)
    return
  }
  await enqueueContentAgentEvent(
    { orgId: args.orgId, eventId: `own_db_connected:${args.orgId}`, name: 'own_db_connected', occurredAt: new Date() },
    { admin },
  )
}

/** A settled org-subscription Paddle transaction (webhook OR API-verified sync) → subscription_payment. */
export async function recordPaddlePayment(args: { orgId: string; txn: PaddleTransactionLike; admin?: Admin }): Promise<void> {
  if (!contentAgentConfigured()) return
  const fields = paymentEventFromTransaction(args.txn)
  if (!fields) return
  await enqueueContentAgentEvent({ orgId: args.orgId, ...fields }, { admin: args.admin })
}

/**
 * An approved refund/chargeback adjustment → refund. The org comes from the stored
 * billing_transactions row, which exists only for supalens's OWN org transactions — a proxy
 * (partner) adjustment finds no row and records nothing.
 */
export async function recordPaddleRefund(args: { adj: PaddleAdjustmentLike; admin?: Admin }): Promise<void> {
  if (!contentAgentConfigured() || !args.adj?.transaction_id) return
  const admin = args.admin ?? createAdminClient()
  if (!admin) return
  let row: { org_id: string; currency: string | null } | undefined
  try {
    const { data, error } = await admin
      .from('billing_transactions')
      .select('org_id, currency')
      .eq('paddle_transaction_id', args.adj.transaction_id)
      .limit(1)
    if (error) throw error
    row = data?.[0] as { org_id: string; currency: string | null } | undefined
  } catch (err) {
    report('refund lookup', err)
    return
  }
  if (!row?.org_id) return
  const fields = refundEventFromAdjustment(args.adj, row.currency)
  if (!fields) return
  await enqueueContentAgentEvent({ orgId: row.org_id, ...fields }, { admin })
}
