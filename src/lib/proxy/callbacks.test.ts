import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pins for the partner-callback outbox:
 * - signature format matches the documented contract (sha256=HMAC(api_secret, rawBody))
 * - SSRF guard: https+public only for live partners; localhost only for test partners
 * - delivery bookkeeping: 2xx → delivered; failure → backoff; attempt cap → failed + Sentry
 * - enqueue is exactly-once (23505 duplicate → silent skip) and pull-only partners skip entirely
 */

const captureMessage = vi.fn()
vi.mock('@sentry/node', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
  captureException: vi.fn(),
}))

import {
  signCallbackBody,
  isDeliverableUrl,
  deliverCallback,
  enqueueCallback,
  CALLBACK_MAX_ATTEMPTS,
  type DeliverableCallback,
} from './callbacks'

interface Write {
  table: string
  op: 'insert' | 'update'
  values: Record<string, unknown>
}

/** Fake admin covering the outbox chains (insert→select, update→eq). */
function fakeAdmin(opts: { insertError?: { code: string } | null } = {}) {
  const writes: Write[] = []
  const admin = {
    from(table: string) {
      return {
        insert(values: Record<string, unknown>) {
          writes.push({ table, op: 'insert', values })
          return {
            select: async () =>
              opts.insertError ? { data: null, error: opts.insertError } : { data: [{ id: 'cb1', attempts: 0 }], error: null },
          }
        },
        update(values: Record<string, unknown>) {
          return {
            eq: async () => {
              writes.push({ table, op: 'update', values })
              return { data: null, error: null }
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, writes }
}

function deliverable(overrides: Partial<DeliverableCallback> = {}): DeliverableCallback {
  return {
    id: 'cb1',
    attempts: 0,
    event: 'proxy.subscription.activated',
    payload: { event: 'proxy.subscription.activated', subscription_id: 'sub1' },
    callback_url: 'https://partner.example/api/payments/subscription-webhook',
    api_secret: 'secret',
    is_test: false,
    ...overrides,
  }
}

const realFetch = global.fetch

beforeEach(() => {
  captureMessage.mockClear()
})

afterEach(() => {
  global.fetch = realFetch
})

describe('signCallbackBody', () => {
  it('produces sha256=<hex HMAC(secret, body)> — the documented partner verification', () => {
    const body = '{"event":"proxy.subscription.renewed"}'
    const expected = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`
    expect(signCallbackBody('s3cret', body)).toBe(expected)
  })
})

describe('isDeliverableUrl', () => {
  it('allows public https for live partners, rejects http and private hosts', () => {
    expect(isDeliverableUrl('https://partner.example/cb', false)).toBe(true)
    expect(isDeliverableUrl('http://partner.example/cb', false)).toBe(false)
    expect(isDeliverableUrl('https://10.0.0.5/cb', false)).toBe(false)
    expect(isDeliverableUrl('https://192.168.1.1/cb', false)).toBe(false)
    expect(isDeliverableUrl('https://172.20.0.1/cb', false)).toBe(false)
    expect(isDeliverableUrl('https://internal.local/cb', false)).toBe(false)
    expect(isDeliverableUrl('https://localhost/cb', false)).toBe(false)
  })

  it('allows localhost http for test partners but still blocks other private ranges', () => {
    expect(isDeliverableUrl('http://localhost:3070/cb', true)).toBe(true)
    expect(isDeliverableUrl('http://127.0.0.1:3070/cb', true)).toBe(true)
    expect(isDeliverableUrl('http://10.0.0.5/cb', true)).toBe(false)
  })
})

describe('deliverCallback', () => {
  it('marks delivered on 2xx and signs the exact body it sent', async () => {
    let sentBody = ''
    let sentSig = ''
    global.fetch = vi.fn(async (_url, init) => {
      sentBody = String(init?.body)
      sentSig = (init?.headers as Record<string, string>)['X-Signature']
      return new Response('ok', { status: 200 })
    }) as typeof fetch
    const { admin, writes } = fakeAdmin()
    const ok = await deliverCallback(admin, deliverable())
    expect(ok).toBe(true)
    expect(sentSig).toBe(signCallbackBody('secret', sentBody))
    // the frozen payload is enriched with callback_id + sent_at at delivery time
    expect(JSON.parse(sentBody)).toMatchObject({ subscription_id: 'sub1', callback_id: 'cb1' })
    const done = writes.find((w) => w.op === 'update')
    expect(done?.values.status).toBe('delivered')
  })

  it('backs off on failure without exhausting early', async () => {
    global.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch
    const { admin, writes } = fakeAdmin()
    const ok = await deliverCallback(admin, deliverable({ attempts: 2 }))
    expect(ok).toBe(false)
    const upd = writes.find((w) => w.op === 'update')
    expect(upd?.values.attempts).toBe(3)
    expect(upd?.values.status).toBeUndefined() // still pending
    expect(upd?.values.next_attempt_at).toBeDefined()
  })

  it('exhausts to failed + Sentry at the attempt cap', async () => {
    global.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch
    const { admin, writes } = fakeAdmin()
    await deliverCallback(admin, deliverable({ attempts: CALLBACK_MAX_ATTEMPTS - 1 }))
    const upd = writes.find((w) => w.op === 'update')
    expect(upd?.values.status).toBe('failed')
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('exhausted'), expect.anything())
  })

  it('never fetches an undeliverable URL', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    const { admin } = fakeAdmin()
    await deliverCallback(admin, deliverable({ callback_url: 'https://192.168.0.10/cb' }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('enqueueCallback', () => {
  const base = {
    partnerId: 'p1',
    subscriptionId: 'sub1',
    apiSecret: 'secret',
    isTest: false,
    event: 'proxy.subscription.activated' as const,
    dedupeKey: 'evt_1',
    payload: { event: 'proxy.subscription.activated' },
  }

  it('skips pull-only partners (no callback_url) without inserting', async () => {
    const { admin, writes } = fakeAdmin()
    await enqueueCallback(admin, { ...base, callbackUrl: null })
    expect(writes).toHaveLength(0)
  })

  it('silently absorbs a duplicate dedupe_key (webhook re-claim)', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch
    const { admin } = fakeAdmin({ insertError: { code: '23505' } })
    await enqueueCallback(admin, { ...base, callbackUrl: 'https://partner.example/cb' })
    expect(global.fetch).not.toHaveBeenCalled() // duplicate → no delivery attempt either
  })

  it('inserts then attempts immediate delivery', async () => {
    global.fetch = vi.fn(async () => new Response('ok', { status: 200 })) as typeof fetch
    const { admin, writes } = fakeAdmin()
    await enqueueCallback(admin, { ...base, callbackUrl: 'https://partner.example/cb' })
    expect(writes.some((w) => w.op === 'insert' && w.table === 'proxy_callbacks')).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
