// NOT `import 'server-only'` — shared with the Trigger.dev retry cron
// (trigger/cloud/proxy-callbacks.ts), same convention as lib/paddle/*.
//
// Partner callback outbox. enqueueCallback gives exactly-once ENQUEUE per Paddle
// event (unique dedupe_key absorbs webhook re-claims); delivery is at-least-once
// (immediate best-effort attempt + the 5-min Trigger.dev sweep), so partners are
// documented to fulfill idempotently — same contract as the one-off payment proxy.
import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/node'

export type ProxyCallbackEvent =
  | 'proxy.subscription.activated'
  | 'proxy.subscription.renewed'
  | 'proxy.subscription.past_due'
  | 'proxy.subscription.canceled'
  | 'proxy.subscription.refunded'

export const CALLBACK_MAX_ATTEMPTS = 8
export const CALLBACK_RETRY_DELAY_MS = 5 * 60_000
export const CALLBACK_TIMEOUT_MS = 10_000

export interface EnqueueInput {
  partnerId: string
  subscriptionId: string
  callbackUrl: string | null
  apiSecret: string
  isTest: boolean
  event: ProxyCallbackEvent
  /** Paddle event_id — the exactly-once enqueue key. */
  dedupeKey: string
  payload: Record<string, unknown>
}

/**
 * Insert the callback into the outbox (idempotent on dedupe_key), then try an
 * immediate delivery. Partners without a callback_url are pull-only — nothing is
 * enqueued. Never throws: a callback must not fail webhook processing.
 */
export async function enqueueCallback(admin: SupabaseClient, input: EnqueueInput): Promise<void> {
  if (!input.callbackUrl) return
  const { data, error } = await admin
    .from('proxy_callbacks')
    .insert({
      partner_id: input.partnerId,
      subscription_id: input.subscriptionId,
      event: input.event,
      dedupe_key: input.dedupeKey,
      payload: input.payload,
    })
    .select('id, attempts')
  if (error) {
    if (error.code !== '23505') {
      console.error('[proxy-callbacks] enqueue failed:', error)
      Sentry.captureException(error, { tags: { area: 'proxy-callbacks' } })
    }
    return // duplicate event (webhook re-claim) or logged failure — either way, don't re-send
  }
  const row = data?.[0] as { id: string; attempts: number } | undefined
  if (!row) return
  try {
    await deliverCallback(admin, {
      id: row.id,
      attempts: row.attempts,
      event: input.event,
      payload: input.payload,
      callback_url: input.callbackUrl,
      api_secret: input.apiSecret,
      is_test: input.isTest,
    })
  } catch (err) {
    // the cron sweep retries; never propagate into webhook processing
    console.warn('[proxy-callbacks] immediate delivery attempt failed:', err)
  }
}

export interface DeliverableCallback {
  id: string
  attempts: number
  event: string
  payload: Record<string, unknown>
  callback_url: string
  api_secret: string
  is_test: boolean
}

/**
 * SSRF guard for partner callback URLs: https + public-looking host only.
 * Hostname-pattern blocklist (not full DNS resolution) — callback_url is set by
 * OUR ops via scripts/proxy-partner.ts, so this is defense-in-depth, not the only
 * gate. Test partners may use localhost over http.
 */
export function isDeliverableUrl(urlString: string, isTest: boolean): boolean {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return false
  }
  const host = url.hostname
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  if (isTest) return (url.protocol === 'https:' || url.protocol === 'http:') && (!isLocal || host === 'localhost' || host === '127.0.0.1')
  return url.protocol === 'https:' && !isLocal
}

export function signCallbackBody(apiSecret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', apiSecret).update(rawBody).digest('hex')}`
}

/**
 * One delivery attempt + outcome bookkeeping. 2xx → delivered; anything else →
 * attempts+1 and a 5-min backoff; attempt CALLBACK_MAX_ATTEMPTS exhausts the row
 * ('failed' + Sentry — v1 manual resend = flip status back to 'pending').
 */
export async function deliverCallback(admin: SupabaseClient, cb: DeliverableCallback): Promise<boolean> {
  const fail = async (message: string, exhaustable = true) => {
    const attempts = cb.attempts + 1
    const exhausted = exhaustable && attempts >= CALLBACK_MAX_ATTEMPTS
    await admin
      .from('proxy_callbacks')
      .update({
        attempts,
        last_error: message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + CALLBACK_RETRY_DELAY_MS).toISOString(),
        ...(exhausted ? { status: 'failed' } : {}),
      })
      .eq('id', cb.id)
    if (exhausted) {
      Sentry.captureMessage(`proxy: callback ${cb.id} (${cb.event}) exhausted ${CALLBACK_MAX_ATTEMPTS} attempts — ${message}`, {
        level: 'error',
      })
    }
    return false
  }

  if (!isDeliverableUrl(cb.callback_url, cb.is_test)) {
    return fail(`undeliverable callback_url: ${cb.callback_url}`)
  }

  const body = JSON.stringify({ ...cb.payload, callback_id: cb.id, sent_at: new Date().toISOString() })
  let res: Response
  try {
    res = await fetch(cb.callback_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signCallbackBody(cb.api_secret, body),
        'X-Proxy-Event': cb.event,
        'User-Agent': 'supalens-proxy/1.0',
      },
      body,
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'fetch_failed')
  }
  if (!res.ok) {
    return fail(`partner responded ${res.status}`)
  }
  await admin
    .from('proxy_callbacks')
    .update({ status: 'delivered', delivered_at: new Date().toISOString(), attempts: cb.attempts + 1, last_error: null })
    .eq('id', cb.id)
  return true
}

/**
 * Sweep due pending callbacks (the Trigger.dev cron body). Joins the partner for
 * fresh credentials — a rotated api_secret applies to retries automatically.
 */
export async function sweepPendingCallbacks(admin: SupabaseClient, limit = 50): Promise<{ sent: number; failed: number }> {
  const { data } = await admin
    .from('proxy_callbacks')
    .select('id, attempts, event, payload, proxy_partners (callback_url, api_secret, is_test)')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at')
    .limit(limit)

  let sent = 0
  let failed = 0
  for (const raw of data ?? []) {
    const row = raw as unknown as {
      id: string
      attempts: number
      event: string
      payload: Record<string, unknown>
      proxy_partners:
        | { callback_url: string | null; api_secret: string; is_test: boolean }
        | Array<{ callback_url: string | null; api_secret: string; is_test: boolean }>
        | null
    }
    const partner = Array.isArray(row.proxy_partners) ? row.proxy_partners[0] : row.proxy_partners
    if (!partner?.callback_url) {
      await admin.from('proxy_callbacks').update({ status: 'failed', last_error: 'no_callback_url' }).eq('id', row.id)
      failed += 1
      continue
    }
    const ok = await deliverCallback(admin, {
      id: row.id,
      attempts: row.attempts,
      event: row.event,
      payload: row.payload,
      callback_url: partner.callback_url,
      api_secret: partner.api_secret,
      is_test: partner.is_test,
    })
    if (ok) sent += 1
    else failed += 1
  }
  return { sent, failed }
}
