import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pins for the checkout→provisioning race fixes (a $1 live test payment landed as a
 * settled transaction with NO subscription linkage, leaving the org free forever):
 * - syncCheckoutTransaction POLLS the transaction until Paddle links the subscription
 * - when the poll runs out, it records breadcrumbs and reports `transaction_pending`
 *   (never a silent ok) so the UI doesn't claim an upgrade that didn't provision
 * - reconcileOrgSubscription self-heals an unlinked org from (a) the stored transaction
 *   and (b) the customer's subscriptions matched by checkout custom_data.org_id
 */

const getTransaction = vi.fn()
const getSubscription = vi.fn()
const listSubscriptionsByCustomer = vi.fn()
vi.mock('./client', () => ({
  getTransaction: (...a: unknown[]) => getTransaction(...a),
  getSubscription: (...a: unknown[]) => getSubscription(...a),
  listSubscriptionsByCustomer: (...a: unknown[]) => listSubscriptionsByCustomer(...a),
}))

const handleSubscriptionEvent = vi.fn()
const handleTransactionEvent = vi.fn()
vi.mock('./webhook-handlers', () => ({
  handleSubscriptionEvent: (...a: unknown[]) => handleSubscriptionEvent(...a),
  handleTransactionEvent: (...a: unknown[]) => handleTransactionEvent(...a),
}))

const captureMessage = vi.fn()
vi.mock('@sentry/node', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  captureException: vi.fn(),
}))

let adminMock: unknown
vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => adminMock as SupabaseClient,
}))

import { syncCheckoutTransaction, reconcileOrgSubscription } from './sync'

/** Fake admin covering exactly the chains sync.ts uses. */
function makeAdmin({ org, tx }: { org?: Record<string, unknown> | null; tx?: Record<string, unknown> | null } = {}) {
  return {
    from(table: string) {
      if (table === 'organizations') {
        return {
          select: () => ({ eq: () => ({ limit: async () => ({ data: org ? [org] : [], error: null }) }) }),
        }
      }
      if (table === 'billing_transactions') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: async () => ({ data: tx ? [tx] : [], error: null }) }) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('syncCheckoutTransaction — subscription-linkage race', () => {
  it('polls the transaction until the subscription id appears, then provisions it', async () => {
    adminMock = makeAdmin()
    getTransaction
      .mockResolvedValueOnce({ id: 'txn_1', status: 'completed' }) // initial read: no linkage yet
      .mockResolvedValueOnce({ id: 'txn_1', status: 'completed' }) // poll 1: still none
      .mockResolvedValueOnce({ id: 'txn_1', status: 'completed', subscription_id: 'sub_1' }) // poll 2: linked
    getSubscription.mockResolvedValue({ id: 'sub_1', status: 'active', custom_data: { org_id: 'org_1' } })

    const res = await syncCheckoutTransaction('txn_1', { pollAttempts: 3, pollDelayMs: 0 })

    expect(res).toEqual({ ok: true })
    expect(getTransaction).toHaveBeenCalledTimes(3)
    expect(handleSubscriptionEvent).toHaveBeenCalledTimes(1)
    expect(handleTransactionEvent).toHaveBeenCalledTimes(1)
  })

  it('reports transaction_pending (not a silent ok) when the linkage never appears', async () => {
    adminMock = makeAdmin()
    getTransaction.mockResolvedValue({ id: 'txn_1', status: 'completed' }) // never links

    const res = await syncCheckoutTransaction('txn_1', { pollAttempts: 2, pollDelayMs: 0 })

    expect(res).toEqual({ ok: false, error: 'transaction_pending' })
    expect(handleSubscriptionEvent).not.toHaveBeenCalled()
    expect(handleTransactionEvent).toHaveBeenCalledTimes(1) // breadcrumbs still recorded
    expect(captureMessage).toHaveBeenCalledTimes(1)
  })
})

describe('reconcileOrgSubscription — self-heal for a paid-but-unlinked org', () => {
  it('follows the stored transaction breadcrumb to the now-linked subscription', async () => {
    adminMock = makeAdmin({
      org: { paddle_subscription_id: null, paddle_customer_id: null },
      tx: { paddle_transaction_id: 'txn_1', paddle_subscription_id: null },
    })
    getTransaction.mockResolvedValue({ id: 'txn_1', subscription_id: 'sub_1' })
    getSubscription.mockResolvedValue({ id: 'sub_1', status: 'active', custom_data: { org_id: 'org_1' } })

    await expect(reconcileOrgSubscription('org_1')).resolves.toBe(true)
    expect(handleSubscriptionEvent).toHaveBeenCalledTimes(1)
  })

  it('falls back to the customer subscription scan, matching THIS org only', async () => {
    adminMock = makeAdmin({ org: { paddle_subscription_id: null, paddle_customer_id: 'ctm_1' }, tx: null })
    listSubscriptionsByCustomer.mockResolvedValue([
      { id: 'sub_other', custom_data: { org_id: 'org_other' } },
      { id: 'sub_mine', custom_data: { org_id: 'org_1' } },
    ])
    getSubscription.mockResolvedValue({ id: 'sub_mine', status: 'active', custom_data: { org_id: 'org_1' } })

    await expect(reconcileOrgSubscription('org_1')).resolves.toBe(true)
    expect(getSubscription).toHaveBeenCalledWith('sub_mine')
  })

  it('returns false when the org has no linkage and no breadcrumbs', async () => {
    adminMock = makeAdmin({ org: { paddle_subscription_id: null, paddle_customer_id: null }, tx: null })

    await expect(reconcileOrgSubscription('org_1')).resolves.toBe(false)
    expect(handleSubscriptionEvent).not.toHaveBeenCalled()
  })
})
