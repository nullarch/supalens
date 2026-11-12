import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The webhook and the event hub together: proxy and foreign traffic send nothing, and a hub outage
 * keeps the billing write, answers non-2xx, and survives the idempotency claim on redelivery.
 */

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@/lib/paddle/config', () => ({
  getPaddleConfig: () => ({ webhookSecret: 'secret' }),
  planForPriceId: () => null,
}))
vi.mock('@/lib/paddle/webhook-verify', () => ({ verifyPaddleSignature: () => true }))

let adminMock: SupabaseClient
vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => adminMock,
  createAdminClient: () => adminMock,
}))

const handleProxyTransactionEvent = vi.fn()
const handleProxyAdjustmentEvent = vi.fn()
vi.mock('@/lib/proxy/webhook-handlers', async (original) => ({
  ...(await original<typeof import('@/lib/proxy/webhook-handlers')>()),
  handleProxyTransactionEvent: (...args: unknown[]) => handleProxyTransactionEvent(...args),
  handleProxyAdjustmentEvent: (...args: unknown[]) => handleProxyAdjustmentEvent(...args),
  handleProxySubscriptionEvent: vi.fn(),
}))

import { POST } from './route'
import { handleTransactionEvent } from '@/lib/paddle/webhook-handlers'
import { fakeAdmin } from '@/lib/event-hub/fake-admin'

const fetchMock = vi.fn()

function hubAnswers(status: number) {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), { status }))
}

function deliver(event: Record<string, unknown>) {
  return POST(new Request('https://supalens.ai/api/paddle/webhook', { method: 'POST', body: JSON.stringify(event) }))
}

const completed = (customData: Record<string, unknown> = { org_id: 'org1' }, id = 'evt_txn') => ({
  event_id: id,
  event_type: 'transaction.completed',
  occurred_at: '2026-10-01T00:00:05Z',
  data: {
    id: 'txn_1',
    status: 'completed',
    subscription_id: 'sub_1',
    custom_data: customData,
    currency_code: 'USD',
    details: { totals: { grand_total: '1999' } },
    billed_at: '2026-10-01T00:00:00Z',
  },
})

const refunded = (id = 'evt_adj') => ({
  event_id: id,
  event_type: 'adjustment.updated',
  occurred_at: '2026-10-02T00:00:05Z',
  data: {
    id: 'adj_1',
    action: 'refund',
    status: 'approved',
    transaction_id: 'txn_1',
    currency_code: 'USD',
    totals: { total: '1999', currency_code: 'USD' },
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
  },
})

function setup(failures?: Parameters<typeof fakeAdmin>[1]) {
  const fake = fakeAdmin(
    { organization_members: [{ org_id: 'org1', user_id: 'owner-1', role: 'owner' }], organizations: [] },
    failures,
  )
  adminMock = fake.admin
  return fake.tables
}

beforeEach(() => {
  vi.stubEnv('STREAMIZE_EVENTS_URL', 'https://hub.test')
  vi.stubEnv('STREAMIZE_EVENTS_KEY', 'test-key')
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  hubAnswers(200)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockReset()
  handleProxyTransactionEvent.mockReset()
  handleProxyAdjustmentEvent.mockReset()
})

describe('Paddle webhook → event hub', () => {
  it('sends a payment after the billing row is written', async () => {
    const tables = setup()
    fetchMock.mockImplementation(async () => {
      expect(tables.billing_transactions).toHaveLength(1)
      return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), { status: 200 })
    })
    const res = await deliver(completed())
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(tables.paddle_webhook_events[0].status).toBe('processed')
  })

  it('sends nothing for proxy traffic', async () => {
    const tables = setup()
    const res = await deliver(completed({ proxy_subscription_id: 'ps_1', org_id: 'org1' }))
    expect(res.status).toBe(200)
    expect(handleProxyTransactionEvent).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tables.billing_transactions ?? []).toHaveLength(0)
  })

  it('sends nothing for a proxy adjustment, which has no billing_transactions row', async () => {
    setup()
    const res = await deliver(refunded())
    expect(res.status).toBe(200)
    expect(handleProxyAdjustmentEvent).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing for another service on the shared Paddle account', async () => {
    const tables = setup()
    const res = await deliver(completed({ app: 'tellscene' }))
    expect(await res.json()).toEqual({ ok: true, ignored: 'other_service' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tables.paddle_webhook_events ?? []).toHaveLength(0)
  })

  it('keeps the billing write through an outage, then delivers the same event on redelivery', async () => {
    const tables = setup()
    hubAnswers(503)

    const first = await deliver(completed())
    expect(first.status).toBe(503)
    expect(tables.billing_transactions[0]).toMatchObject({ paddle_transaction_id: 'txn_1', status: 'completed' })
    expect(tables.paddle_webhook_events[0].status).toBe('invalid')

    hubAnswers(200)
    const second = await deliver(completed())
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true })
    expect(tables.paddle_webhook_events[0].status).toBe('processed')
    expect(tables.billing_transactions).toHaveLength(1)
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body)

    // Delivered once more: the claim now swallows it, correctly.
    expect(await (await deliver(completed())).json()).toEqual({ ok: true, duplicate: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a payment redelivered after a refund does not undo the refund', async () => {
    const tables = setup()
    hubAnswers(503)
    await deliver(completed())

    hubAnswers(200)
    await deliver(refunded())
    expect(tables.billing_transactions[0].status).toBe('refunded')

    await deliver(completed())
    expect(tables.billing_transactions[0].status).toBe('refunded')
    const names = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string).events[0].name)
    expect(names.slice(-2).sort()).toEqual(['refund', 'subscription_payment'])
  })

  it('retries a refund through an outage', async () => {
    const tables = setup()
    await deliver(completed())
    hubAnswers(500)
    expect((await deliver(refunded())).status).toBe(503)
    expect(tables.billing_transactions[0].status).toBe('refunded')
    hubAnswers(200)
    expect((await deliver(refunded())).status).toBe(200)
  })

  it('does not retry an event the hub refused', async () => {
    const tables = setup()
    hubAnswers(400)
    expect((await deliver(completed())).status).toBe(200)
    expect(tables.paddle_webhook_events[0].status).toBe('processed')
  })

  it('is a plain success without the env vars', async () => {
    vi.stubEnv('STREAMIZE_EVENTS_URL', '')
    const tables = setup()
    expect((await deliver(completed())).status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tables.billing_transactions).toHaveLength(1)
  })

  it('sends nothing when the billing write failed, and asks Paddle to redeliver', async () => {
    setup({ upsert: { code: '57014', message: 'timeout' } })
    expect((await deliver(completed())).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not loop on a forged org id', async () => {
    setup({ upsert: { code: '23503', message: 'foreign key' } })
    expect((await deliver(completed())).status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the API sync path records the transaction without sending', async () => {
    const tables = setup()
    await handleTransactionEvent(adminMock, completed().data)
    expect(tables.billing_transactions).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
