import { describe, expect, it } from 'vitest'

import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_RETRY_AFTER_MS,
  backoffDelayMs,
  classifyResponse,
  decideAction,
  halve,
  networkFailure,
  nextAttemptDelayMs,
  parseAcceptedBody,
  parseRetryAfterMs,
  planBatches,
  requestBody,
} from './delivery'

/**
 * Pins for the outbox delivery policy (the tracking contract):
 * - ≤100 events AND ≤128 KB per request, order preserved, nothing dropped
 * - only HTTP 200 is "delivered"; 413 splits; 400 bisects down to the single bad event;
 *   401/403/404/3xx halt the sweep; 429/5xx/network back off (Retry-After honored, 6 h cap)
 */

const item = (i: number, pad = 0) => ({ id: `row-${i}`, payload: { eventId: `e-${i}`, name: 'signup', pad: 'x'.repeat(pad) } })
const bytes = (s: string) => new TextEncoder().encode(s).length

describe('planBatches', () => {
  it('caps events per request and preserves order', () => {
    const items = Array.from({ length: 250 }, (_, i) => item(i))
    const batches = planBatches(items)
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50])
    expect(batches.flat()).toEqual(items)
  })
  it('caps the request body size — every planned body fits', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i, 10_000)) // ~10 KB each
    const batches = planBatches(items)
    expect(batches.length).toBeGreaterThan(1)
    for (const b of batches) expect(bytes(requestBody(b))).toBeLessThanOrEqual(128_000)
    expect(batches.flat()).toEqual(items)
  })
  it('packs exactly to the byte limit (comma accounting)', () => {
    const items = [item(1), item(2), item(3)]
    const exact = bytes(requestBody(items.slice(0, 2)))
    expect(planBatches(items, 100, exact).map((b) => b.length)).toEqual([2, 1])
    expect(planBatches(items, 100, exact - 1).map((b) => b.length)).toEqual([1, 1, 1])
  })
  it('an oversized single event still gets its own batch (413 → attention), never dropped', () => {
    const items = [item(1), item(2, 200_000), item(3)]
    expect(planBatches(items).map((b) => b.map((r) => r.id))).toEqual([['row-1'], ['row-2'], ['row-3']])
  })
  it('empty in → empty out', () => {
    expect(planBatches([])).toEqual([])
  })
})

describe('requestBody', () => {
  it('is the {"events":[…]} envelope of the stored payloads, verbatim', () => {
    expect(requestBody([item(1)])).toBe('{"events":[{"eventId":"e-1","name":"signup","pad":""}]}')
  })
})

describe('halve', () => {
  it('splits order-preserving', () => {
    expect(halve([1, 2, 3, 4, 5])).toEqual([[1, 2, 3], [4, 5]])
  })
})

describe('classifyResponse + decideAction', () => {
  const now = Date.parse('2026-09-25T00:00:00Z')
  it('only 200 is delivered', () => {
    expect(classifyResponse(200, null, now)).toEqual({ kind: 'delivered' })
    expect(decideAction(classifyResponse(200, null, now), 10)).toBe('mark_delivered')
    for (const s of [201, 202, 204]) expect(decideAction(classifyResponse(s, null, now), 10)).toBe('backoff')
  })
  it('413 splits a batch; a single oversized event is parked', () => {
    expect(decideAction(classifyResponse(413, null, now), 2)).toBe('bisect')
    expect(decideAction(classifyResponse(413, null, now), 1)).toBe('mark_failed')
  })
  it('400 (whole batch rolled back) bisects to the bad event, then parks it with the error', () => {
    const v = classifyResponse(400, null, now, '{"error":"event_id_conflict","eventId":"e-7"}')
    expect(v).toEqual({ kind: 'rejected', reason: 'HTTP 400: {"error":"event_id_conflict","eventId":"e-7"}' })
    expect(decideAction(v, 50)).toBe('bisect')
    expect(decideAction(v, 1)).toBe('mark_failed')
    expect(decideAction(classifyResponse(422, null, now), 1)).toBe('mark_failed')
  })
  it('401/403/404/3xx halt (credentials / endpoint problem — no retry loop)', () => {
    for (const s of [401, 403, 404, 301, 302, 307]) {
      expect(decideAction(classifyResponse(s, null, now), 5)).toBe('halt')
    }
  })
  it('429/5xx/408 back off and honor Retry-After', () => {
    expect(classifyResponse(429, '120', now)).toMatchObject({ kind: 'retry', retryAfterMs: 120_000 })
    expect(classifyResponse(503, 'Fri, 25 Sep 2026 00:10:00 GMT', now)).toMatchObject({ kind: 'retry', retryAfterMs: 600_000 })
    for (const s of [408, 425, 500, 502, 504]) expect(decideAction(classifyResponse(s, null, now), 5)).toBe('backoff')
    expect(decideAction(networkFailure(new Error('ECONNRESET')), 5)).toBe('backoff')
  })
  it('truncates a long error body', () => {
    const v = classifyResponse(400, null, now, 'x'.repeat(5000))
    expect('reason' in v && v.reason.length).toBeLessThan(320)
  })
})

describe('parseRetryAfterMs', () => {
  const now = Date.parse('2026-09-25T00:00:00Z')
  it('delta-seconds, HTTP-date (past clamps to 0), garbage', () => {
    expect(parseRetryAfterMs('30', now)).toBe(30_000)
    expect(parseRetryAfterMs('Thu, 24 Sep 2026 00:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfterMs('soon', now)).toBeNull()
    expect(parseRetryAfterMs(null, now)).toBeNull()
  })
})

describe('backoff', () => {
  it('doubles from 1 minute and caps at 6 hours', () => {
    expect(backoffDelayMs(1)).toBe(BASE_BACKOFF_MS)
    expect(backoffDelayMs(2)).toBe(2 * BASE_BACKOFF_MS)
    expect(backoffDelayMs(5)).toBe(16 * BASE_BACKOFF_MS)
    expect(backoffDelayMs(9)).toBe(256 * BASE_BACKOFF_MS)
    expect(backoffDelayMs(10)).toBe(MAX_BACKOFF_MS)
    expect(backoffDelayMs(1000)).toBe(MAX_BACKOFF_MS)
    expect(backoffDelayMs(0)).toBe(BASE_BACKOFF_MS)
  })
  it('a longer Retry-After wins; an absurd one is clamped', () => {
    expect(nextAttemptDelayMs(1, 10_000)).toBe(BASE_BACKOFF_MS) // server allows sooner → keep backoff
    expect(nextAttemptDelayMs(1, 30 * 60_000)).toBe(30 * 60_000)
    expect(nextAttemptDelayMs(1, 10 * MAX_RETRY_AFTER_MS)).toBe(MAX_RETRY_AFTER_MS)
    expect(nextAttemptDelayMs(3, null)).toBe(4 * BASE_BACKOFF_MS)
  })
})

describe('parseAcceptedBody', () => {
  it('reads the counts, tolerating junk', () => {
    expect(parseAcceptedBody('{"accepted":3,"duplicates":1}')).toEqual({ accepted: 3, duplicates: 1 })
    expect(parseAcceptedBody('ok')).toEqual({ accepted: 0, duplicates: 0 })
  })
})
