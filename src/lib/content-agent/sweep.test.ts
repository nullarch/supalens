import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pins for the outbox sweep (io half):
 * - no-op when unconfigured; server-to-server POST (Bearer, JSON, NO Origin), payloads verbatim
 * - delivered ONLY on 200
 * - a 400 (whole batch rolled back) is bisected down to the one bad event, which is parked with
 *   its error — the good events still deliver, no id is ever re-minted
 * - 401 parks the batch at the max backoff and stops the sweep (no retry loop)
 * - 429/5xx/network reschedule with backoff honoring Retry-After and stop the sweep
 */

const captureMessage = vi.fn()
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: (...a: unknown[]) => captureMessage(...a) }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => null }))

import { deliverContentAgentOutbox } from './sweep'
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS } from './delivery'

interface Row {
  id: string
  event_id: string
  payload: Record<string, unknown>
  attempts: number
}
type Update = { values: Record<string, unknown>; ids: string[] }

const NOW = Date.parse('2026-09-25T00:00:00Z')
const row = (id: string, attempts = 0): Row => ({
  id,
  event_id: `signup:${id}`,
  payload: { eventId: `signup:${id}`, name: 'signup', occurredAt: '2026-09-24T00:00:00.000Z' },
  attempts,
})

function fakeAdmin(due: Row[], opts: { selectError?: unknown } = {}) {
  const updates: Update[] = []
  const selects: Array<{ op: string; args: unknown[] }> = []
  const admin = {
    from() {
      const state: { update?: Record<string, unknown>; ids?: string[]; isSelect?: boolean } = {}
      const b: Record<string, unknown> = {}
      for (const op of ['select', 'is', 'lte', 'order', 'limit']) {
        b[op] = (...args: unknown[]) => {
          if (op === 'select') state.isSelect = true
          selects.push({ op, args })
          return b
        }
      }
      b.update = (values: Record<string, unknown>) => {
        state.update = values
        return b
      }
      b.in = (_col: string, ids: string[]) => {
        state.ids = ids
        return b
      }
      b.then = (resolve: (v: unknown) => unknown) => {
        if (state.update) {
          updates.push({ values: state.update, ids: state.ids ?? [] })
          return Promise.resolve(resolve({ data: null, error: null }))
        }
        return Promise.resolve(resolve(opts.selectError ? { data: null, error: opts.selectError } : { data: due, error: null }))
      }
      return b
    },
  } as unknown as SupabaseClient
  return { admin, updates, selects }
}

type Reply = { status: number; body?: string; headers?: Record<string, string> } | Error
function fakeFetch(reply: (events: Array<{ eventId: string }>) => Reply) {
  const requests: Array<{ url: string; init: RequestInit; events: Array<{ eventId: string }> }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const events = (JSON.parse(String(init?.body)) as { events: Array<{ eventId: string }> }).events
    requests.push({ url: String(url), init: init!, events })
    const r = reply(events)
    if (r instanceof Error) throw r
    return new Response(r.body ?? '', { status: r.status, headers: r.headers })
  })
  return { fetchImpl: fn as unknown as typeof fetch, requests }
}

beforeEach(() => {
  captureMessage.mockClear()
  process.env.CONTENT_AGENT_TRACKING_URL = 'https://track.example.com/tracking/supalens/events'
  process.env.CONTENT_AGENT_TRACKING_TOKEN = 'tok'
})
afterEach(() => {
  delete process.env.CONTENT_AGENT_TRACKING_URL
  delete process.env.CONTENT_AGENT_TRACKING_TOKEN
})

const run = (admin: SupabaseClient, fetchImpl: typeof fetch) => deliverContentAgentOutbox({ admin, fetchImpl, now: () => NOW })

describe('deliverContentAgentOutbox', () => {
  it('is a no-op when unconfigured', async () => {
    delete process.env.CONTENT_AGENT_TRACKING_URL
    const { admin, updates, selects } = fakeAdmin([row('a')])
    const { fetchImpl, requests } = fakeFetch(() => ({ status: 200 }))
    await expect(run(admin, fetchImpl)).resolves.toMatchObject({ configured: false, requests: 0 })
    expect(requests).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(selects).toHaveLength(0)
  })

  it('selects due, undelivered, unparked rows oldest-first (≤100) and POSTs them server-to-server', async () => {
    const due = [row('a'), row('b')]
    const { admin, updates, selects } = fakeAdmin(due)
    const { fetchImpl, requests } = fakeFetch(() => ({ status: 200, body: '{"accepted":1,"duplicates":1}' }))
    const report = await run(admin, fetchImpl)

    expect(selects).toContainEqual({ op: 'is', args: ['delivered_at', null] })
    expect(selects).toContainEqual({ op: 'is', args: ['failed_at', null] })
    expect(selects).toContainEqual({ op: 'lte', args: ['next_attempt_at', new Date(NOW).toISOString()] })
    expect(selects).toContainEqual({ op: 'order', args: ['created_at', { ascending: true }] })
    expect(selects).toContainEqual({ op: 'limit', args: [100] })

    expect(requests).toHaveLength(1)
    const { url, init, events } = requests[0]
    expect(url).toBe('https://track.example.com/tracking/supalens/events')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['Content-Type']).toBe('application/json')
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('origin')
    expect(events).toEqual(due.map((r) => r.payload)) // verbatim

    expect(updates).toHaveLength(1)
    expect(updates[0].ids).toEqual(['a', 'b'])
    expect(updates[0].values).toEqual({ delivered_at: new Date(NOW).toISOString(), last_error: null })
    expect(report).toMatchObject({ configured: true, due: 2, delivered: 2, accepted: 1, duplicates: 1, failed: 0, haltedBy: null })
  })

  it('bisects a 400 down to the single bad event; the rest deliver', async () => {
    const { admin, updates } = fakeAdmin([row('a'), row('b'), row('c')])
    const { fetchImpl, requests } = fakeFetch((events) =>
      events.some((e) => e.eventId === 'signup:b') ? { status: 400, body: '{"error":"event_id_conflict"}' } : { status: 200 },
    )
    const report = await run(admin, fetchImpl)

    expect(requests.map((r) => r.events.map((e) => e.eventId))).toEqual([
      ['signup:a', 'signup:b', 'signup:c'],
      ['signup:a', 'signup:b'],
      ['signup:a'],
      ['signup:b'],
      ['signup:c'],
    ])
    const failed = updates.find((u) => 'failed_at' in u.values)
    expect(failed).toEqual({
      ids: ['b'],
      values: { failed_at: new Date(NOW).toISOString(), last_error: 'HTTP 400: {"error":"event_id_conflict"}' },
    })
    const delivered = updates.filter((u) => 'delivered_at' in u.values).flatMap((u) => u.ids)
    expect(delivered.sort()).toEqual(['a', 'c'])
    expect(report).toMatchObject({ delivered: 2, failed: 1 })
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('signup:b'), expect.anything())
  })

  it('413 splits the batch', async () => {
    const { admin, updates } = fakeAdmin([row('a'), row('b')])
    const { fetchImpl, requests } = fakeFetch((events) => (events.length > 1 ? { status: 413 } : { status: 200 }))
    await run(admin, fetchImpl)
    expect(requests.map((r) => r.events.length)).toEqual([2, 1, 1])
    expect(updates.filter((u) => 'delivered_at' in u.values).flatMap((u) => u.ids)).toEqual(['a', 'b'])
  })

  it('401 parks the batch at the max backoff, stops, and surfaces — no retry loop', async () => {
    const { admin, updates } = fakeAdmin([row('a', 2), row('b', 2)])
    const { fetchImpl, requests } = fakeFetch(() => ({ status: 401, body: 'bad token' }))
    const report = await run(admin, fetchImpl)
    expect(requests).toHaveLength(1)
    expect(updates).toEqual([
      {
        ids: ['a', 'b'],
        values: { attempts: 3, last_error: 'HTTP 401: bad token', next_attempt_at: new Date(NOW + MAX_BACKOFF_MS).toISOString() },
      },
    ])
    expect(updates.some((u) => 'delivered_at' in u.values || 'failed_at' in u.values)).toBe(false)
    expect(report.haltedBy).toBe('HTTP 401: bad token')
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('CONTENT_AGENT_TRACKING_TOKEN'), expect.anything())
  })

  it('429 reschedules with backoff honoring Retry-After (grouped by attempts) and stops', async () => {
    const { admin, updates } = fakeAdmin([row('a', 0), row('b', 4)])
    const { fetchImpl, requests } = fakeFetch(() => ({ status: 429, headers: { 'Retry-After': '120' } }))
    const report = await run(admin, fetchImpl)
    expect(requests).toHaveLength(1)
    expect(updates).toEqual([
      // 1st failure: backoff 1 min < Retry-After 2 min → 2 min
      { ids: ['a'], values: { attempts: 1, last_error: 'HTTP 429', next_attempt_at: new Date(NOW + 120_000).toISOString() } },
      // 5th failure: backoff 16 min > Retry-After
      { ids: ['b'], values: { attempts: 5, last_error: 'HTTP 429', next_attempt_at: new Date(NOW + 16 * BASE_BACKOFF_MS).toISOString() } },
    ])
    expect(report).toMatchObject({ deferred: 2, delivered: 0, haltedBy: 'HTTP 429' })
  })

  it('a network error reschedules with backoff', async () => {
    const { admin, updates } = fakeAdmin([row('a')])
    const { fetchImpl } = fakeFetch(() => new Error('ECONNRESET'))
    await run(admin, fetchImpl)
    expect(updates).toEqual([
      { ids: ['a'], values: { attempts: 1, last_error: 'network: ECONNRESET', next_attempt_at: new Date(NOW + BASE_BACKOFF_MS).toISOString() } },
    ])
  })

  it('throws on an outbox read error (task-level retry is safe — ids are stable)', async () => {
    const { admin } = fakeAdmin([], { selectError: { message: 'boom' } })
    const { fetchImpl, requests } = fakeFetch(() => ({ status: 200 }))
    await expect(run(admin, fetchImpl)).rejects.toMatchObject({ message: 'boom' })
    expect(requests).toHaveLength(0)
  })

  it('nothing due → no request', async () => {
    const { admin } = fakeAdmin([])
    const { fetchImpl, requests } = fakeFetch(() => ({ status: 200 }))
    await expect(run(admin, fetchImpl)).resolves.toMatchObject({ configured: true, due: 0, requests: 0 })
    expect(requests).toHaveLength(0)
  })
})
