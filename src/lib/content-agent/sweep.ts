// NOTE: intentionally NOT `import 'server-only'` — this is the body of the Trigger.dev cron
// (trigger/cloud/content-agent-outbox.ts), same convention as lib/proxy/callbacks.ts. @sentry/node is
// initialized there by trigger/sentry.ts.
//
// Delivery half of the content-agent tracking outbox: POST due rows to the ingress, mark delivered
// only on HTTP 200, and back off / park everything else. Idempotent by eventId end to end — a
// crash between the POST and the bookkeeping just resends the same ids + payloads next sweep, which
// the ingress counts as duplicates.
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/node'

import { createAdminClient } from '@/utils/supabase/admin'
import { getContentAgentConfig, type ContentAgentConfig } from './config'
import {
  MAX_BACKOFF_MS,
  MAX_EVENTS_PER_REQUEST,
  classifyResponse,
  decideAction,
  halve,
  networkFailure,
  nextAttemptDelayMs,
  parseAcceptedBody,
  planBatches,
  requestBody,
  type DeliveryVerdict,
} from './delivery'

export const REQUEST_TIMEOUT_MS = 15_000
/** Hard cap on POSTs per sweep (bisecting a poisoned batch of 100 is bounded by this too). */
export const MAX_REQUESTS_PER_SWEEP = 40

interface OutboxRow {
  id: string
  event_id: string
  payload: unknown
  attempts: number
}

export interface SweepReport {
  configured: boolean
  due: number
  requests: number
  delivered: number
  accepted: number
  duplicates: number
  /** rows parked for a human (single-event 400/413) */
  failed: number
  /** rows rescheduled (transient failure or halt) */
  deferred: number
  /** set when the sweep stopped early (auth/endpoint problem or a transient failure) */
  haltedBy: string | null
}

async function postBatch(
  cfg: ContentAgentConfig,
  batch: OutboxRow[],
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<{ verdict: DeliveryVerdict; body: string }> {
  let res: Response
  try {
    res = await fetchImpl(cfg.url, {
      method: 'POST',
      // Server-to-server: no Origin header (the ingress rejects browser-originated requests).
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'supalens-content-agent/1.0',
      },
      body: requestBody(batch),
      // A redirect would turn the POST into a body-less GET — surface it as a config problem instead.
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    return { verdict: networkFailure(err), body: '' }
  }
  let body = ''
  try {
    body = await res.text()
  } catch {
    /* body is informational only */
  }
  return { verdict: classifyResponse(res.status, res.headers.get('retry-after'), nowMs, body), body }
}

/** Reschedule a batch: attempts+1, last_error, next_attempt_at — one UPDATE per distinct attempts value. */
async function deferBatch(
  admin: SupabaseClient,
  batch: OutboxRow[],
  reason: string,
  delayFor: (attempts: number) => number,
  nowMs: number,
): Promise<void> {
  const byAttempts = new Map<number, string[]>()
  for (const row of batch) {
    const ids = byAttempts.get(row.attempts) ?? []
    ids.push(row.id)
    byAttempts.set(row.attempts, ids)
  }
  for (const [attempts, ids] of byAttempts) {
    const next = attempts + 1
    const { error } = await admin
      .from('content_agent_outbox')
      .update({
        attempts: next,
        last_error: reason.slice(0, 500),
        next_attempt_at: new Date(nowMs + delayFor(next)).toISOString(),
      })
      .in('id', ids)
    if (error) throw error
  }
}

/**
 * One sweep (the cron body). Selects up to one request's worth of due rows (oldest first,
 * respecting next_attempt_at), packs them under the contract limits, and walks the batches.
 * Throws only on outbox READ/WRITE errors (the task retries — safe, ids are stable); every
 * ingress outcome is bookkept and reported instead.
 */
export async function deliverContentAgentOutbox(
  opts: { admin?: SupabaseClient; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<SweepReport> {
  const report: SweepReport = {
    configured: false,
    due: 0,
    requests: 0,
    delivered: 0,
    accepted: 0,
    duplicates: 0,
    failed: 0,
    deferred: 0,
    haltedBy: null,
  }
  const cfg = getContentAgentConfig()
  if (!cfg) return report
  const admin = opts.admin ?? createAdminClient()
  if (!admin) return report
  report.configured = true
  const now = opts.now ?? Date.now
  const fetchImpl = opts.fetchImpl ?? fetch

  const { data, error } = await admin
    .from('content_agent_outbox')
    .select('id, event_id, payload, attempts')
    .is('delivered_at', null)
    .is('failed_at', null)
    .lte('next_attempt_at', new Date(now()).toISOString())
    .order('created_at', { ascending: true })
    .limit(MAX_EVENTS_PER_REQUEST)
  if (error) throw error
  const rows = (data ?? []) as OutboxRow[]
  report.due = rows.length

  const queue = planBatches(rows)
  while (queue.length > 0 && report.requests < MAX_REQUESTS_PER_SWEEP) {
    const batch = queue.shift()!
    report.requests += 1
    const nowMs = now()
    const { verdict, body } = await postBatch(cfg, batch, fetchImpl, nowMs)
    const ids = batch.map((r) => r.id)

    switch (decideAction(verdict, batch.length)) {
      case 'mark_delivered': {
        const { error: upErr } = await admin
          .from('content_agent_outbox')
          .update({ delivered_at: new Date(nowMs).toISOString(), last_error: null })
          .in('id', ids)
        if (upErr) throw upErr
        const counts = parseAcceptedBody(body)
        report.delivered += batch.length
        report.accepted += counts.accepted
        report.duplicates += counts.duplicates
        break
      }
      case 'bisect': {
        queue.unshift(...halve(batch).filter((half) => half.length > 0))
        break
      }
      case 'mark_failed': {
        const reason = 'reason' in verdict ? verdict.reason : 'rejected'
        const { error: upErr } = await admin
          .from('content_agent_outbox')
          .update({ failed_at: new Date(nowMs).toISOString(), last_error: reason.slice(0, 500) })
          .in('id', ids)
        if (upErr) throw upErr
        report.failed += batch.length
        // Needs a human: never re-minted, never auto-retried (requeue = clear failed_at).
        Sentry.captureMessage(
          `content-agent: event ${batch[0]?.event_id} rejected by the tracking ingress — ${reason}`,
          { level: 'error', tags: { area: 'content-agent' } },
        )
        break
      }
      case 'halt': {
        const reason = 'reason' in verdict ? verdict.reason : 'halt'
        // Credentials/endpoint problem: every request would fail identically. Park this batch at
        // the max backoff (auto-resumes once the env is fixed) and stop — no retry loop.
        await deferBatch(admin, batch, reason, () => MAX_BACKOFF_MS, nowMs)
        report.deferred += batch.length
        report.haltedBy = reason
        Sentry.captureMessage(
          `content-agent: tracking ingress refused delivery (${reason}) — check CONTENT_AGENT_TRACKING_URL / CONTENT_AGENT_TRACKING_TOKEN`,
          { level: 'error', tags: { area: 'content-agent' } },
        )
        return report
      }
      case 'backoff': {
        const reason = 'reason' in verdict ? verdict.reason : 'retry'
        const retryAfterMs = verdict.kind === 'retry' ? verdict.retryAfterMs : null
        await deferBatch(admin, batch, reason, (attempts) => nextAttemptDelayMs(attempts, retryAfterMs), nowMs)
        report.deferred += batch.length
        report.haltedBy = reason
        return report // the ingress is struggling (429/5xx/network) — don't push more this sweep
      }
    }
  }
  return report
}
