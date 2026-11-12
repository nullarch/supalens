import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pins for the Paddle provisioning handlers:
 * - ordering guard skips stale events (entity updated_at watermark)
 * - a live subscription is never RELINKED to a different one (client-set custom_data abuse)
 * - an unmapped price id alerts a human instead of silently leaving the old plan
 * - subscription.canceled clears the dead subscription link + scheduled_change
 * - approved refunds/chargebacks mark the stored transaction
 */

const captureMessage = vi.fn()
vi.mock('@sentry/node', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
  captureException: vi.fn(),
}))

import { handleSubscriptionEvent, handleAdjustmentEvent, type PaddleSubscriptionData } from './webhook-handlers'

interface Update {
  table: string
  values: Record<string, unknown>
}

/** Fake admin client covering exactly the chains the handlers use (select→eq→limit, update→eq[.eq|.is][.select]). */
function fakeAdmin(orgRow: Record<string, unknown> | null) {
  const updates: Update[] = []
  const admin = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: orgRow ? [orgRow] : [], error: null }),
          }),
        }),
        update(values: Record<string, unknown>) {
          const record = { table, values }
          const chain = {
            eq: () => chain,
            is: () => chain,
            select: async () => {
              updates.push(record)
              return { data: [{ id: 'org1' }], error: null }
            },
            then: (resolve: (v: { data: null; error: null }) => unknown) => {
              updates.push(record)
              return Promise.resolve(resolve({ data: null, error: null }))
            },
          }
          return chain
        },
      }
    },
  } as unknown as SupabaseClient
  return { admin, updates }
}

function orgState(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'basic',
    subscription_status: 'active',
    current_period_starts_at: '2026-07-01T00:00:00Z',
    billing_event_at: '2026-07-05T00:00:00Z',
    current_period_query_count: 10,
    paddle_customer_id: 'ctm_1',
    paddle_subscription_id: 'sub_A',
    ...overrides,
  }
}

function subEvent(overrides: Partial<PaddleSubscriptionData> = {}): PaddleSubscriptionData {
  return {
    id: 'sub_A',
    status: 'active',
    customer_id: 'ctm_1',
    custom_data: { org_id: 'org1' },
    items: [{ price: { id: 'pri_basic' } }],
    // same period start as stored → not a renewal (keeps the CAS path out of these tests)
    current_billing_period: { starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-08-01T00:00:00Z' },
    updated_at: '2026-07-10T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  captureMessage.mockClear()
  process.env.PADDLE_PRICE_ID_BASIC = 'pri_basic'
  process.env.PADDLE_PRICE_ID_STANDARD = 'pri_standard'
})

afterEach(() => {
  delete process.env.PADDLE_PRICE_ID_BASIC
  delete process.env.PADDLE_PRICE_ID_STANDARD
})

describe('handleSubscriptionEvent', () => {
  it('applies a newer snapshot and maps the plan from the price id', async () => {
    const { admin, updates } = fakeAdmin(orgState())
    await handleSubscriptionEvent(admin, 'subscription.updated', subEvent({ items: [{ price: { id: 'pri_standard' } }] }))
    const patch = updates.find((u) => u.table === 'organizations' && 'billing_event_at' in u.values)
    expect(patch).toBeDefined()
    expect(patch!.values.plan).toBe('standard')
    // watermark = the subscription ENTITY's updated_at, not the delivery occurred_at
    expect(patch!.values.billing_event_at).toBe('2026-07-10T00:00:00Z')
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('skips an event older than the stored watermark (ordering guard)', async () => {
    const { admin, updates } = fakeAdmin(orgState({ billing_event_at: '2026-07-11T00:00:00Z' }))
    await handleSubscriptionEvent(admin, 'subscription.updated', subEvent()) // updated_at 07-10 < stored 07-11
    expect(updates).toHaveLength(0)
  })

  it('refuses to relink an org away from a LIVE subscription (custom_data abuse guard)', async () => {
    const { admin, updates } = fakeAdmin(orgState()) // live sub_A
    await handleSubscriptionEvent(admin, 'subscription.created', subEvent({ id: 'sub_ATTACKER' }))
    expect(updates).toHaveLength(0)
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('refused to relink'), expect.anything())
  })

  it('allows relinking after the stored subscription is canceled (legit re-subscribe)', async () => {
    const { admin, updates } = fakeAdmin(orgState({ subscription_status: 'canceled', plan: 'free' }))
    await handleSubscriptionEvent(admin, 'subscription.created', subEvent({ id: 'sub_B' }))
    const patch = updates.find((u) => 'billing_event_at' in u.values)
    expect(patch).toBeDefined()
    expect(patch!.values.paddle_subscription_id).toBe('sub_B')
  })

  it('alerts (but still provisions the rest) when no plan maps to the price ids', async () => {
    const { admin, updates } = fakeAdmin(orgState())
    await handleSubscriptionEvent(admin, 'subscription.updated', subEvent({ items: [{ price: { id: 'pri_mystery' } }] }))
    const patch = updates.find((u) => 'billing_event_at' in u.values)
    expect(patch).toBeDefined()
    expect(patch!.values).not.toHaveProperty('plan') // old plan untouched, never silently downgraded
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('no plan mapped'), expect.anything())
  })

  it('canceled → free AND clears the dead subscription link + scheduled_change', async () => {
    const { admin, updates } = fakeAdmin(orgState())
    await handleSubscriptionEvent(
      admin,
      'subscription.canceled',
      subEvent({ status: 'canceled', scheduled_change: { action: 'cancel', effective_at: '2026-08-01T00:00:00Z' } }),
    )
    const patch = updates.find((u) => 'billing_event_at' in u.values)
    expect(patch).toBeDefined()
    expect(patch!.values.plan).toBe('free')
    expect(patch!.values.paddle_subscription_id).toBeNull()
    expect(patch!.values.scheduled_change).toBeNull()
    expect(patch!.values.paddle_customer_id).toBe('ctm_1') // portal + history keep working
  })
})

describe('handleAdjustmentEvent', () => {
  it('marks the stored transaction refunded on an approved refund', async () => {
    const { admin, updates } = fakeAdmin(null)
    await handleAdjustmentEvent(admin, { id: 'adj_1', action: 'refund', status: 'approved', transaction_id: 'txn_1' })
    expect(updates).toEqual([{ table: 'billing_transactions', values: { status: 'refunded' } }])
  })

  it('marks chargebacks (which skip the approval flow)', async () => {
    const { admin, updates } = fakeAdmin(null)
    await handleAdjustmentEvent(admin, { id: 'adj_2', action: 'chargeback', transaction_id: 'txn_1' })
    expect(updates).toEqual([{ table: 'billing_transactions', values: { status: 'chargeback' } }])
  })

  it('ignores rejected/pending adjustments and non-refund actions', async () => {
    const { admin, updates } = fakeAdmin(null)
    await handleAdjustmentEvent(admin, { id: 'adj_3', action: 'refund', status: 'rejected', transaction_id: 'txn_1' })
    await handleAdjustmentEvent(admin, { id: 'adj_4', action: 'refund', status: 'pending_approval', transaction_id: 'txn_1' })
    await handleAdjustmentEvent(admin, { id: 'adj_5', action: 'credit', status: 'approved', transaction_id: 'txn_1' })
    await handleAdjustmentEvent(admin, { id: 'adj_6', action: 'refund', status: 'approved' }) // no transaction id
    expect(updates).toHaveLength(0)
  })
})
