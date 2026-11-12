import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pins for the proxy provisioning handlers:
 * - ordering guard skips stale events (entity updated_at watermark, mirrors org handler)
 * - callbacks fire on TRANSITIONS only: activated once, past_due once, canceled once
 * - transaction kind: the checkout transaction is 'initial' (no callback), later ones
 *   are 'renewal' (proxy.subscription.renewed)
 * - unknown subscription → Sentry page (money may be unprovisioned)
 * - adjustments no-op for non-proxy transactions, relay refunds for proxy ones
 */

const captureMessage = vi.fn()
vi.mock('@sentry/node', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
  captureException: vi.fn(),
}))

const enqueueCallback = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock('./callbacks', () => ({
  enqueueCallback: (...args: unknown[]) => enqueueCallback(...args),
}))

import {
  isProxyCustomData,
  handleProxySubscriptionEvent,
  handleProxyTransactionEvent,
  handleProxyAdjustmentEvent,
} from './webhook-handlers'
import type { PaddleSubscriptionData } from '@/lib/paddle/webhook-handlers'

interface Write {
  table: string
  op: 'update' | 'upsert'
  values: Record<string, unknown>
}

/**
 * Fake admin covering the proxy handler chains:
 * select→eq→limit (row lookup by table), update→eq (thenable, optional .is),
 * upsert (thenable). Rows are matched per-table, first-eq-wins.
 */
function fakeAdmin(rowsByTable: Record<string, Record<string, unknown>[]>) {
  const writes: Write[] = []
  const admin = {
    from(table: string) {
      return {
        select: () => ({
          eq: (col: string, val: unknown) => ({
            limit: async () => ({
              data: (rowsByTable[table] ?? []).filter((r) => r[col] === val),
              error: null,
            }),
          }),
        }),
        update(values: Record<string, unknown>) {
          const record: Write = { table, op: 'update', values }
          const chain = {
            eq: () => chain,
            is: () => chain,
            then: (resolve: (v: { data: null; error: null }) => unknown) => {
              writes.push(record)
              return Promise.resolve(resolve({ data: null, error: null }))
            },
          }
          return chain
        },
        upsert: async (values: Record<string, unknown>) => {
          writes.push({ table, op: 'upsert', values })
          return { data: null, error: null }
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, writes }
}

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'psub1',
    partner_id: 'p1',
    product_id: 'prod1',
    partner_user_id: 'user-1',
    partner_order_id: 'order-1',
    status: 'pending',
    paddle_subscription_id: null,
    paddle_customer_id: null,
    paddle_checkout_txn_id: 'txn_initial',
    current_period_starts_at: null,
    current_period_ends_at: null,
    scheduled_change: null,
    canceled_at: null,
    billing_event_at: null,
    metadata: { plan: 'plus' },
    proxy_partners: { code: 'partnerapp', callback_url: 'https://partner.example/cb', api_secret: 's', is_test: false },
    proxy_products: { sku: 'plus_month' },
    ...overrides,
  }
}

function subEvent(overrides: Partial<PaddleSubscriptionData> = {}): PaddleSubscriptionData {
  return {
    id: 'sub_A',
    status: 'active',
    customer_id: 'ctm_1',
    custom_data: { org_id: undefined, proxy_subscription_id: 'psub1' } as never,
    current_billing_period: { starts_at: '2026-08-01T00:00:00Z', ends_at: '2026-09-01T00:00:00Z' },
    updated_at: '2026-08-01T00:00:10Z',
    ...overrides,
  }
}

beforeEach(() => {
  captureMessage.mockClear()
  enqueueCallback.mockClear()
})

describe('isProxyCustomData', () => {
  it('routes only events carrying the proxy stamp', () => {
    expect(isProxyCustomData({ proxy: 1, proxy_subscription_id: 'x' })).toBe(true)
    expect(isProxyCustomData({ org_id: 'org1' })).toBe(false)
    expect(isProxyCustomData(null)).toBe(false)
    expect(isProxyCustomData(undefined)).toBe(false)
  })
})

describe('handleProxySubscriptionEvent', () => {
  it('activates a pending subscription and enqueues proxy.subscription.activated', async () => {
    const { admin, writes } = fakeAdmin({ proxy_subscriptions: [subRow()] })
    await handleProxySubscriptionEvent(admin, 'subscription.activated', subEvent(), 'evt_1')
    const patch = writes.find((w) => w.table === 'proxy_subscriptions')
    expect(patch?.values.status).toBe('active')
    expect(patch?.values.paddle_subscription_id).toBe('sub_A')
    expect(patch?.values.billing_event_at).toBe('2026-08-01T00:00:10Z')
    expect(enqueueCallback).toHaveBeenCalledTimes(1)
    const input = enqueueCallback.mock.calls[0][1] as { event: string; dedupeKey: string; payload: Record<string, unknown> }
    expect(input.event).toBe('proxy.subscription.activated')
    expect(input.dedupeKey).toBe('evt_1')
    expect(input.payload).toMatchObject({ partner_user_id: 'user-1', sku: 'plus_month' })
  })

  it('does NOT re-fire activated for an already-live subscription', async () => {
    const { admin } = fakeAdmin({
      proxy_subscriptions: [subRow({ status: 'active', billing_event_at: '2026-08-01T00:00:00Z' })],
    })
    await handleProxySubscriptionEvent(admin, 'subscription.updated', subEvent(), 'evt_2')
    expect(enqueueCallback).not.toHaveBeenCalled()
  })

  it('skips an event older than the stored watermark (ordering guard)', async () => {
    const { admin, writes } = fakeAdmin({
      proxy_subscriptions: [subRow({ status: 'active', billing_event_at: '2026-08-02T00:00:00Z' })],
    })
    await handleProxySubscriptionEvent(admin, 'subscription.updated', subEvent(), 'evt_3')
    expect(writes).toHaveLength(0)
    expect(enqueueCallback).not.toHaveBeenCalled()
  })

  it('fires past_due only on the first transition into past_due', async () => {
    const live = fakeAdmin({ proxy_subscriptions: [subRow({ status: 'active', billing_event_at: '2026-08-01T00:00:00Z' })] })
    await handleProxySubscriptionEvent(live.admin, 'subscription.updated', subEvent({ status: 'past_due', updated_at: '2026-09-01T00:00:00Z' }), 'evt_4')
    expect(enqueueCallback).toHaveBeenCalledTimes(1)
    expect((enqueueCallback.mock.calls[0][1] as { event: string }).event).toBe('proxy.subscription.past_due')

    enqueueCallback.mockClear()
    const already = fakeAdmin({ proxy_subscriptions: [subRow({ status: 'past_due', billing_event_at: '2026-09-01T00:00:00Z' })] })
    await handleProxySubscriptionEvent(already.admin, 'subscription.updated', subEvent({ status: 'past_due', updated_at: '2026-09-02T00:00:00Z' }), 'evt_5')
    expect(enqueueCallback).not.toHaveBeenCalled()
  })

  it('canceled: stamps canceled_at, clears scheduled_change, enqueues canceled', async () => {
    const { admin, writes } = fakeAdmin({
      proxy_subscriptions: [subRow({ status: 'active', billing_event_at: '2026-08-01T00:00:00Z' })],
    })
    await handleProxySubscriptionEvent(
      admin,
      'subscription.canceled',
      subEvent({ status: 'canceled', updated_at: '2026-09-01T00:00:00Z' }),
      'evt_6',
      '2026-09-01T00:00:01Z',
    )
    const patch = writes.find((w) => w.table === 'proxy_subscriptions')
    expect(patch?.values.status).toBe('canceled')
    expect(patch?.values.canceled_at).toBe('2026-09-01T00:00:01Z')
    expect(patch?.values.scheduled_change).toBeNull()
    expect((enqueueCallback.mock.calls[0][1] as { event: string }).event).toBe('proxy.subscription.canceled')
  })

  it('pages a human when no proxy row matches (money may be unprovisioned)', async () => {
    const { admin } = fakeAdmin({ proxy_subscriptions: [] })
    await handleProxySubscriptionEvent(admin, 'subscription.activated', subEvent(), 'evt_7')
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('unprovisioned'), expect.anything())
    expect(enqueueCallback).not.toHaveBeenCalled()
  })
})

describe('handleProxyTransactionEvent', () => {
  const txnEvent = (id: string) =>
    ({
      id,
      subscription_id: 'sub_A',
      customer_id: 'ctm_1',
      status: 'completed',
      custom_data: { proxy_subscription_id: 'psub1' },
      currency_code: 'USD',
      details: { totals: { grand_total: '990' } },
      billing_period: { starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-10-01T00:00:00Z' },
      billed_at: '2026-09-01T00:00:05Z',
    }) as never

  it('records the checkout transaction as kind=initial WITHOUT a renewed callback', async () => {
    const { admin, writes } = fakeAdmin({ proxy_subscriptions: [subRow()] })
    await handleProxyTransactionEvent(admin, txnEvent('txn_initial'), 'evt_t1')
    const upsert = writes.find((w) => w.op === 'upsert' && w.table === 'proxy_transactions')
    expect(upsert?.values.kind).toBe('initial')
    expect(upsert?.values.amount_cents).toBe(990)
    expect(enqueueCallback).not.toHaveBeenCalled()
  })

  it('records a later transaction as kind=renewal and enqueues proxy.subscription.renewed', async () => {
    const { admin, writes } = fakeAdmin({ proxy_subscriptions: [subRow({ status: 'active' })] })
    await handleProxyTransactionEvent(admin, txnEvent('txn_renewal_2'), 'evt_t2')
    const upsert = writes.find((w) => w.op === 'upsert' && w.table === 'proxy_transactions')
    expect(upsert?.values.kind).toBe('renewal')
    expect(enqueueCallback).toHaveBeenCalledTimes(1)
    const input = enqueueCallback.mock.calls[0][1] as { event: string; payload: Record<string, unknown> }
    expect(input.event).toBe('proxy.subscription.renewed')
    expect(input.payload.transaction).toMatchObject({ id: 'txn_renewal_2', amount_cents: 990 })
    expect(input.payload.current_period_ends_at).toBe('2026-10-01T00:00:00Z')
  })
})

describe('handleProxyAdjustmentEvent', () => {
  const adjustment = { id: 'adj_1', action: 'refund', status: 'approved', transaction_id: 'txn_renewal_2' }

  it('no-ops for transactions that are not proxy traffic', async () => {
    const { admin, writes } = fakeAdmin({ proxy_transactions: [] })
    await handleProxyAdjustmentEvent(admin, adjustment, 'evt_a1')
    expect(writes).toHaveLength(0)
    expect(enqueueCallback).not.toHaveBeenCalled()
  })

  it('marks the proxy transaction refunded and relays proxy.subscription.refunded', async () => {
    const { admin, writes } = fakeAdmin({
      proxy_transactions: [
        {
          id: 'ptx1',
          subscription_id: 'psub1',
          paddle_transaction_id: 'txn_renewal_2',
          amount_cents: 990,
          currency: 'USD',
          billed_at: '2026-09-01T00:00:05Z',
        },
      ],
      proxy_subscriptions: [subRow({ status: 'active' })],
    })
    await handleProxyAdjustmentEvent(admin, adjustment, 'evt_a2')
    const upd = writes.find((w) => w.table === 'proxy_transactions' && w.op === 'update')
    expect(upd?.values.status).toBe('refunded')
    expect(enqueueCallback).toHaveBeenCalledTimes(1)
    const input = enqueueCallback.mock.calls[0][1] as { event: string; payload: Record<string, unknown> }
    expect(input.event).toBe('proxy.subscription.refunded')
    expect(input.payload.transaction).toMatchObject({ id: 'txn_renewal_2', status: 'refunded' })
  })

  it('ignores rejected/pending adjustments', async () => {
    const { admin, writes } = fakeAdmin({ proxy_transactions: [{ id: 'ptx1', paddle_transaction_id: 'txn_renewal_2' }] })
    await handleProxyAdjustmentEvent(admin, { ...adjustment, status: 'rejected' }, 'evt_a3')
    expect(writes).toHaveLength(0)
  })
})
