// NOTE: intentionally NOT `import 'server-only'` — imported by the Paddle handlers, which the
// Trigger-shared paddle/sync.ts also loads. @sentry/node for the same reason.
//
// Sends this service's events to the company event hub (client.ts is the hub's SDK, copied as is).
// Nothing here throws: a hub failure must never fail a billing write, a wizard step or an account
// deletion. Every send is a warned no-op until STREAMIZE_EVENTS_URL/KEY are set.
//
// Re-sending. Event IDs are stable, so replaying is always safe; the hub counts a repeat as a duplicate.
// - Payments and refunds: Paddle redelivers while the webhook answers 503. When its retries run out,
//   the rows in paddle_webhook_events with status 'invalid' (kept 90 days) name what to replay from
//   the Paddle dashboard. The Sentry events tagged area=event-hub carry the same IDs.
// - Activation: nothing redelivers. Re-send from profiles.wizard_completed_at, event ID activation:<id>.
// - data_connected: nothing redelivers. Re-send from the user's first connected data_sources row (see
//   sendDataConnectedToHub), same ID, occurredAt = that row's created_at.
// - first_analysis: nothing redelivers. Re-send from the user's first qualifying agent_runs row (see
//   sendFirstAnalysisToHub), same ID, occurredAt = that row's ended_at. agent_runs is pruned at 180 days.
// - Account deletion: nothing redelivers. Sentry carries the user id; repeat DELETE /v1/people/<id>.
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/node'

import { isCloud } from '@/config/edition'

import { minorAmountToMajor } from '@/lib/content-agent/logic'
import { isProxyCustomData } from '@/lib/proxy/webhook-handlers'
import { createHubClient, HubError, type HubEvent } from './client'

/** 'retry' asks the caller to get the event delivered again (the webhook answers non-2xx). */
export type HubDelivery = 'done' | 'retry'

/** Paddle wants an answer within 5 seconds, and the webhook does its database work first. */
const HUB_TIMEOUT_MS = 3000

interface HubTransaction {
  id: string
  status: string
  subscription_id?: string | null
  custom_data?: unknown
  currency_code?: string | null
  details?: { totals?: { grand_total?: string | null } | null } | null
  billed_at?: string | null
  created_at?: string | null
}

interface HubAdjustment {
  id: string
  action?: string | null
  status?: string | null
  transaction_id?: string | null
  currency_code?: string | null
  totals?: { total?: string | null; currency_code?: string | null } | null
  created_at?: string | null
  updated_at?: string | null
}

function hubConfigured(what: string): boolean {
  if (process.env.STREAMIZE_EVENTS_URL && process.env.STREAMIZE_EVENTS_KEY) return true
  // Hosted-service telemetry; a self-hosted install has no hub and should not log about it.
  if (isCloud()) console.warn(`[event-hub] STREAMIZE_EVENTS_URL/KEY unset, skipped ${what}`)
  return false
}

const hub = () => createHubClient({ timeoutMs: HUB_TIMEOUT_MS })

function reportFailure(where: string, id: string, err: unknown, retry: boolean): void {
  console.error(`[event-hub] ${where} ${id} failed (retry=${retry}):`, err)
  Sentry.captureException(err, {
    level: retry ? 'warning' : 'error',
    tags: { area: 'event-hub', where, retry: String(retry) },
    extra: { id, status: err instanceof HubError ? err.status : undefined },
  })
}

function reportSkip(message: string): void {
  console.warn(`[event-hub] ${message}`)
  Sentry.captureMessage(`event-hub: ${message}`, { level: 'error', tags: { area: 'event-hub' } })
}

function outcomeOf(where: string, id: string, err: unknown): HubDelivery {
  // Anything but a definite "fix it" answer may be temporary.
  const retry = err instanceof HubError ? err.retry : true
  reportFailure(where, id, err, retry)
  return retry ? 'retry' : 'done'
}

/** Proxy-gateway money belongs to partners, and the Paddle account also carries other company services. */
function belongsElsewhere(customData: unknown): boolean {
  if (isProxyCustomData(customData)) return true
  const app = (customData as { app?: unknown } | null | undefined)?.app
  return app != null && app !== 'supalens'
}

/**
 * Billing is per org, the hub's person is the org owner's auth user id. Oldest owner first, so an org
 * with several owners resolves the same way on every retry. Throws on a read failure: sending without
 * a userRef now and with one on the retry would be a reused event ID with different data.
 */
async function orgOwnerId(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .order('user_id', { ascending: true })
    .limit(1)
  if (error) throw error
  return (data?.[0] as { user_id: string } | undefined)?.user_id ?? null
}

async function sendOrgEvent(admin: SupabaseClient, orgId: string, event: HubEvent): Promise<HubDelivery> {
  try {
    const owner = await orgOwnerId(admin, orgId)
    // A deleted org has no members left. The money still moved, so the event still counts.
    if (!owner) console.warn(`[event-hub] org ${orgId} has no owner, sending ${event.eventId} without userRef`)
    await hub().send([{ ...event, ...(owner ? { userRef: owner } : {}) }])
    return 'done'
  } catch (err) {
    return outcomeOf('billing', event.eventId, err)
  }
}

/** A settled org transaction → `subscription_payment` or `purchase`. Partner, foreign and $0 transactions send nothing. */
export async function sendPaymentToHub(admin: SupabaseClient, orgId: string, txn: HubTransaction): Promise<HubDelivery> {
  if (belongsElsewhere(txn.custom_data)) return 'done'
  if (txn.status !== 'completed' && txn.status !== 'paid') return 'done'
  if (!hubConfigured(`payment ${txn.id}`)) return 'done'

  const value = minorAmountToMajor(txn.details?.totals?.grand_total, txn.currency_code)
  if (value == null) {
    reportSkip(`transaction ${txn.id} has no usable amount or currency, not sent`)
    return 'done'
  }
  if (value <= 0) return 'done' // trial starts and fully credited changes are not revenue
  // Never the clock: a retry must repeat the same timestamp or the hub refuses it as different data.
  const occurredAt = txn.billed_at ?? txn.created_at
  if (!occurredAt) {
    reportSkip(`transaction ${txn.id} has no timestamp, not sent`)
    return 'done'
  }

  const name = txn.subscription_id ? 'subscription_payment' : 'purchase'
  return sendOrgEvent(admin, orgId, {
    eventId: `${name}:${txn.id}`,
    name,
    occurredAt,
    value,
    currency: txn.currency_code!.toUpperCase(),
    props: {
      org_id: orgId,
      paddle_transaction_id: txn.id,
      ...(txn.subscription_id ? { paddle_subscription_id: txn.subscription_id } : {}),
    },
  })
}

/**
 * An approved refund → `refund`, one per adjustment so partial refunds stay distinct. The org comes
 * from the stored billing_transactions row, which only Supalens's own transactions have: adjustments
 * carry no custom_data, so this lookup is what keeps partner and foreign refunds out.
 *
 * Dated by created_at, not updated_at: a later adjustment.updated would otherwise reuse this ID with
 * a different timestamp, which the hub refuses.
 */
export async function sendRefundToHub(admin: SupabaseClient, adj: HubAdjustment): Promise<HubDelivery> {
  if (adj.action !== 'refund' || adj.status !== 'approved' || !adj.transaction_id) return 'done'
  if (!hubConfigured(`refund ${adj.id}`)) return 'done'

  const { data, error } = await admin
    .from('billing_transactions')
    .select('org_id, currency')
    .eq('paddle_transaction_id', adj.transaction_id)
    .limit(1)
  if (error) return outcomeOf('billing', `refund:${adj.id}`, error)
  const row = data?.[0] as { org_id: string; currency: string | null } | undefined
  if (!row) return 'done'

  const currency = adj.totals?.currency_code ?? adj.currency_code ?? row.currency
  const raw = adj.totals?.total
  const minor = raw != null ? Math.abs(Number(raw)) : null
  const value = minorAmountToMajor(minor, currency)
  const occurredAt = adj.created_at ?? adj.updated_at
  if (value == null || !occurredAt) {
    reportSkip(`adjustment ${adj.id} has no usable amount, currency or timestamp, not sent`)
    return 'done'
  }

  return sendOrgEvent(admin, row.org_id, {
    eventId: `refund:${adj.id}`,
    name: 'refund',
    occurredAt,
    value,
    currency: currency!.toUpperCase(),
    props: { org_id: row.org_id, paddle_transaction_id: adj.transaction_id, paddle_adjustment_id: adj.id },
  })
}

/** The wizard was just completed for the first time. occurredAt is the stored wizard_completed_at. */
export async function sendActivationToHub(userId: string, occurredAt: string): Promise<void> {
  if (!hubConfigured(`activation ${userId}`)) return
  const eventId = `activation:${userId}`
  try {
    await hub().send([{ eventId, name: 'activation', occurredAt, userRef: userId }])
  } catch (err) {
    reportFailure('activation', eventId, err, err instanceof HubError ? err.retry : true)
  }
}

/**
 * A data source just went active. Sends `data_connected` when it is the acting user's first real one.
 *
 * "First" is the earliest connect among real sources this user created, live or removed, plus this
 * source, which may be another member's failed row this user just healed. Picking one row rather than
 * asking "does another exist?" means two concurrent connects cannot both stand aside. The half-created
 * row a failed credential store leaves behind never connected, so it does not count.
 *
 * Dated by created_at because it never changes: a re-provisioned source moves last_connected_at, and
 * re-sending with a new timestamp would be refused. Users who connected before this shipped stay
 * silent here and need a backfill.
 */
export async function sendDataConnectedToHub(admin: SupabaseClient, userId: string, dataSourceId: string): Promise<void> {
  if (!hubConfigured(`data_connected ${userId}`)) return
  const eventId = `data_connected:${userId}`
  try {
    const { data, error } = await admin
      .from('data_sources')
      .select('id, org_id, engine, provider, status, deleted_at, created_at')
      .or(`created_by.eq.${userId},id.eq.${dataSourceId}`)
      .eq('is_demo', false)
      .not('last_connected_at', 'is', null)
      .order('last_connected_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(100)
    if (error) throw error
    const rows = (data ?? []) as Array<{
      id: string
      org_id: string
      engine: string
      provider: string
      status: string
      deleted_at: string | null
      created_at: string
    }>
    const first = rows.find((row) => !(row.status === 'error' && row.deleted_at))
    if (first?.id !== dataSourceId) return
    await hub().send([{
      eventId,
      name: 'data_connected',
      occurredAt: first.created_at,
      userRef: userId,
      props: { org_id: first.org_id, data_source_id: first.id, engine: first.engine, provider: first.provider },
    }])
  } catch (err) {
    reportFailure('data-connected', eventId, err, err instanceof HubError ? err.retry : true)
  }
}

/** Where a person asked. Absent channel means web, on rows older than the column. */
const QUESTION_CHANNELS = new Set<string | null>([null, 'web', 'mcp'])

/**
 * A run just succeeded. Sends `first_analysis` when it is this user's first answered question on real data.
 *
 * Mirrors activation/logic.ts, which counts only real sources: a run on a demo source does not qualify,
 * and neither does a run without a person (Slack, incidents) or a monitor drafting run (channel 'monitor'),
 * which produces a draft rather than an answer.
 *
 * A concurrent run finishing at the same moment sees the same earliest row, so only that run sends. Users
 * who analyzed before this shipped stay silent here and need a backfill. Once a user's older runs age out
 * of agent_runs (180 days), a new run can read as first; the hub refuses it if the old event is there.
 */
export async function sendFirstAnalysisToHub(admin: SupabaseClient, userId: string, runId: string): Promise<void> {
  if (!hubConfigured(`first_analysis ${userId}`)) return
  const eventId = `first_analysis:${userId}`
  try {
    const { data, error } = await admin
      .from('agent_runs')
      .select('id, org_id, data_source_id, channel, ended_at, data_sources!inner(is_demo)')
      .eq('user_id', userId)
      .eq('status', 'succeeded')
      .eq('data_sources.is_demo', false)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(100)
    if (error) throw error
    const rows = (data ?? []) as Array<{
      id: string
      org_id: string
      data_source_id: string
      channel: string | null
      ended_at: string
    }>
    const first = rows.find((row) => QUESTION_CHANNELS.has(row.channel ?? null))
    if (first?.id !== runId) return
    await hub().send([{
      eventId,
      name: 'first_analysis',
      occurredAt: first.ended_at,
      userRef: userId,
      props: { org_id: first.org_id, data_source_id: first.data_source_id, run_id: first.id, channel: first.channel ?? 'web' },
    }])
  } catch (err) {
    reportFailure('first-analysis', eventId, err, err instanceof HubError ? err.retry : true)
  }
}

/** The user's account is gone. Sentry keeps the internal id, the only way left to repeat this. */
export async function forgetHubPerson(userId: string): Promise<void> {
  if (!hubConfigured(`forget ${userId}`)) return
  try {
    await hub().forgetPerson(userId)
  } catch (err) {
    reportFailure('forget-person', userId, err, err instanceof HubError ? err.retry : true)
  }
}
