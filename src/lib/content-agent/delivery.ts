// PURE — batching, response classification and backoff for the content-agent outbox (pin-tested
// in delivery.test.ts). The io half is sweep.ts. No imports on purpose.

/** Ingress limits from the tracking contract. */
export const MAX_EVENTS_PER_REQUEST = 100
/** "128 KB" read conservatively as 128,000 bytes of request body. */
export const MAX_REQUEST_BYTES = 128_000

/** Backoff after a retryable failure: 1 min doubling per failed attempt, capped at 6 h. */
export const BASE_BACKOFF_MS = 60_000
export const MAX_BACKOFF_MS = 6 * 60 * 60_000
/** A Retry-After beyond this is treated as garbage and clamped. */
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000

const encoder = new TextEncoder()
function byteLength(s: string): number {
  return encoder.encode(s).length
}

/** The exact request body for a batch — the stored payloads, verbatim and in order. */
export function requestBody(items: ReadonlyArray<{ payload: unknown }>): string {
  return JSON.stringify({ events: items.map((i) => i.payload) })
}

const ENVELOPE_BYTES = byteLength(requestBody([]))

/**
 * Greedy, order-preserving split into requests of ≤ MAX_EVENTS_PER_REQUEST events and
 * ≤ MAX_REQUEST_BYTES of body. An event that alone exceeds the byte cap still gets its own batch
 * (the ingress then answers 413 and the sweep marks it for attention) — nothing is dropped here.
 */
export function planBatches<T extends { payload: unknown }>(
  items: ReadonlyArray<T>,
  maxEvents: number = MAX_EVENTS_PER_REQUEST,
  maxBytes: number = MAX_REQUEST_BYTES,
): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let bytes = ENVELOPE_BYTES
  for (const item of items) {
    const size = byteLength(JSON.stringify(item.payload))
    const withComma = current.length > 0 ? size + 1 : size
    if (current.length > 0 && (current.length >= maxEvents || bytes + withComma > maxBytes)) {
      batches.push(current)
      current = []
      bytes = ENVELOPE_BYTES
    }
    bytes += current.length > 0 ? size + 1 : size
    current.push(item)
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/** Split a batch in two (order-preserving) — used to isolate a rejected event or shrink a 413. */
export function halve<T>(batch: ReadonlyArray<T>): [T[], T[]] {
  const mid = Math.ceil(batch.length / 2)
  return [batch.slice(0, mid), batch.slice(mid)]
}

/** Parse Retry-After (delta-seconds or HTTP-date) into a wait in ms; unparseable → null. */
export function parseRetryAfterMs(header: string | null | undefined, nowMs: number): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - nowMs)
}

export type DeliveryVerdict =
  /** HTTP 200 — the ONLY status that marks events delivered. */
  | { kind: 'delivered' }
  /** 413 — the body is too large; split and resend. */
  | { kind: 'too_large'; reason: string }
  /** 400 / other 4xx — the whole batch was rolled back (e.g. an eventId reused with changed data). */
  | { kind: 'rejected'; reason: string }
  /** 401 / 403 / 404 / 3xx — a credentials or endpoint problem: every request would fail the same way. */
  | { kind: 'halt'; reason: string }
  /** 408 / 425 / 429 / 5xx / network / unexpected 2xx — transient: same ids + payloads later. */
  | { kind: 'retry'; reason: string; retryAfterMs: number | null }

function excerpt(body: string | null | undefined): string {
  const b = (body ?? '').replace(/\s+/g, ' ').trim()
  return b ? `: ${b.slice(0, 300)}` : ''
}

export function classifyResponse(
  status: number,
  retryAfter: string | null | undefined,
  nowMs: number,
  body?: string | null,
): DeliveryVerdict {
  if (status === 200) return { kind: 'delivered' }
  if (status === 413) return { kind: 'too_large', reason: `HTTP 413${excerpt(body)}` }
  if (status === 401 || status === 403 || status === 404 || (status >= 300 && status < 400)) {
    return { kind: 'halt', reason: `HTTP ${status}${excerpt(body)}` }
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500 || (status >= 200 && status < 300)) {
    return { kind: 'retry', reason: `HTTP ${status}${excerpt(body)}`, retryAfterMs: parseRetryAfterMs(retryAfter, nowMs) }
  }
  return { kind: 'rejected', reason: `HTTP ${status}${excerpt(body)}` }
}

export function networkFailure(err: unknown): DeliveryVerdict {
  const message = err instanceof Error ? err.message : String(err)
  return { kind: 'retry', reason: `network: ${message.slice(0, 300)}`, retryAfterMs: null }
}

/**
 * What the sweep does with a batch given the verdict:
 * - mark_delivered — 200.
 * - bisect         — 400/413 on a multi-event batch: resend each half so one bad event (a reused
 *                    eventId with changed data rolls the WHOLE batch back) can't block the rest.
 * - mark_failed    — 400/413 on a single event: park it for a human (never re-minted, never looped).
 * - halt           — 401/403/404/3xx: park the batch at the max backoff and stop the sweep.
 * - backoff        — transient: reschedule the batch (backoff / Retry-After) and stop the sweep.
 */
export type BatchAction = 'mark_delivered' | 'bisect' | 'mark_failed' | 'halt' | 'backoff'

export function decideAction(verdict: DeliveryVerdict, batchSize: number): BatchAction {
  switch (verdict.kind) {
    case 'delivered':
      return 'mark_delivered'
    case 'too_large':
    case 'rejected':
      return batchSize > 1 ? 'bisect' : 'mark_failed'
    case 'halt':
      return 'halt'
    case 'retry':
      return 'backoff'
  }
}

/** Backoff for the Nth failed attempt (1-based): 1, 2, 4, … min, capped at 6 h. */
export function backoffDelayMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts))
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(n - 1, 30))
}

/** Delay before the next try: the exponential backoff, or longer when the server asked for it. */
export function nextAttemptDelayMs(attempts: number, retryAfterMs: number | null): number {
  const backoff = backoffDelayMs(attempts)
  if (retryAfterMs == null) return backoff
  return Math.max(backoff, Math.min(Math.max(0, retryAfterMs), MAX_RETRY_AFTER_MS))
}

/** Pull `{accepted, duplicates}` off a 200 body (informational only — never gates delivery). */
export function parseAcceptedBody(body: string | null | undefined): { accepted: number; duplicates: number } {
  try {
    const parsed = JSON.parse(body ?? '') as { accepted?: unknown; duplicates?: unknown }
    return {
      accepted: typeof parsed.accepted === 'number' ? parsed.accepted : 0,
      duplicates: typeof parsed.duplicates === 'number' ? parsed.duplicates : 0,
    }
  } catch {
    return { accepted: 0, duplicates: 0 }
  }
}
