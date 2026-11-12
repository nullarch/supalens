import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins for what reaches the event hub: amounts in major units, stable IDs and timestamps, the org
 * owner as userRef, nothing for partner or foreign money, and which hub answers ask for a retry.
 */

const captureException = vi.fn()
vi.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureMessage: vi.fn(),
}))

import {
  forgetHubPerson,
  sendActivationToHub,
  sendDataConnectedToHub,
  sendFirstAnalysisToHub,
  sendPaymentToHub,
  sendRefundToHub,
} from './events'
import { fakeAdmin } from './fake-admin'

const fetchMock = vi.fn()

function hubAnswers(status: number, body: unknown = { accepted: 1, duplicates: 0 }) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

function sentEvent(call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string).events[0]
}

const members = [
  { org_id: 'org1', user_id: 'owner-1', role: 'owner' },
  { org_id: 'org1', user_id: 'member-1', role: 'member' },
]

function txn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn_1',
    status: 'completed',
    subscription_id: 'sub_1',
    custom_data: { org_id: 'org1' },
    currency_code: 'USD',
    details: { totals: { grand_total: '1999' } },
    billed_at: '2026-10-01T00:00:00.123456Z',
    created_at: '2026-09-30T00:00:00Z',
    ...overrides,
  }
}

function adjustment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'adj_1',
    action: 'refund',
    status: 'approved',
    transaction_id: 'txn_1',
    currency_code: 'USD',
    totals: { total: '500', currency_code: 'USD' },
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    ...overrides,
  }
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
  captureException.mockReset()
})

describe('sendPaymentToHub', () => {
  it('sends a subscription charge in major units as the org owner', async () => {
    const { admin } = fakeAdmin({ organization_members: members })
    expect(await sendPaymentToHub(admin, 'org1', txn())).toBe('done')
    expect(sentEvent()).toEqual({
      eventId: 'subscription_payment:txn_1',
      name: 'subscription_payment',
      occurredAt: '2026-10-01T00:00:00.123456Z',
      value: 19.99,
      currency: 'USD',
      userRef: 'owner-1',
      props: { org_id: 'org1', paddle_transaction_id: 'txn_1', paddle_subscription_id: 'sub_1' },
    })
  })

  it('sends a transaction without a subscription as a purchase', async () => {
    const { admin } = fakeAdmin({ organization_members: members })
    await sendPaymentToHub(admin, 'org1', txn({ subscription_id: null }))
    expect(sentEvent()).toMatchObject({ eventId: 'purchase:txn_1', name: 'purchase' })
  })

  it.each([
    ['KRW', '29000', 29000],
    ['JPY', '3000', 3000],
    ['EUR', '1050', 10.5],
  ])('converts %s minor units', async (currency, total, value) => {
    const { admin } = fakeAdmin({ organization_members: members })
    await sendPaymentToHub(admin, 'org1', txn({ currency_code: currency, details: { totals: { grand_total: total } } }))
    expect(sentEvent()).toMatchObject({ value, currency })
  })

  it('uppercases the currency, which the hub requires', async () => {
    const { admin } = fakeAdmin({ organization_members: members })
    await sendPaymentToHub(admin, 'org1', txn({ currency_code: 'usd' }))
    expect(sentEvent().currency).toBe('USD')
  })

  it('never uses the clock: without a Paddle timestamp nothing is sent', async () => {
    const { admin } = fakeAdmin({ organization_members: members })
    await sendPaymentToHub(admin, 'org1', txn({ billed_at: null, created_at: null }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['proxy traffic', { custom_data: { org_id: 'org1', proxy_subscription_id: 'ps_1' } }],
    ['another service', { custom_data: { org_id: 'org1', app: 'tellscene' } }],
    ['a $0 transaction', { details: { totals: { grand_total: '0' } } }],
    ['an unsettled transaction', { status: 'billed' }],
    ['an unusable amount', { details: { totals: { grand_total: null } } }],
    ['a missing currency', { currency_code: null }],
  ])('sends nothing for %s', async (_label, overrides) => {
    const { admin } = fakeAdmin({ organization_members: members })
    expect(await sendPaymentToHub(admin, 'org1', txn(overrides))).toBe('done')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still counts the money when the org has no owner left', async () => {
    const { admin } = fakeAdmin({ organization_members: [] })
    await sendPaymentToHub(admin, 'org1', txn())
    expect(sentEvent().userRef).toBeUndefined()
  })

  it.each([
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
    [400, 'done'],
    [401, 'done'],
  ])('a hub %i answers %s', async (status, outcome) => {
    hubAnswers(status, { error: 'nope' })
    const { admin } = fakeAdmin({ organization_members: members })
    expect(await sendPaymentToHub(admin, 'org1', txn())).toBe(outcome)
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('a network failure asks for a retry and does not throw', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const { admin } = fakeAdmin({ organization_members: members })
    expect(await sendPaymentToHub(admin, 'org1', txn())).toBe('retry')
  })

  it('is a warned no-op without the env vars', async () => {
    vi.stubEnv('STREAMIZE_EVENTS_KEY', '')
    const { admin } = fakeAdmin({ organization_members: members })
    expect(await sendPaymentToHub(admin, 'org1', txn())).toBe('done')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
    expect(captureException).not.toHaveBeenCalled()
  })
})

describe('sendRefundToHub', () => {
  const stored = { paddle_transaction_id: 'txn_1', org_id: 'org1', currency: 'USD' }

  it('sends the adjustment amount, keyed and dated stably, as the org owner', async () => {
    const { admin } = fakeAdmin({ organization_members: members, billing_transactions: [stored] })
    expect(await sendRefundToHub(admin, adjustment())).toBe('done')
    expect(sentEvent()).toMatchObject({
      eventId: 'refund:adj_1',
      name: 'refund',
      occurredAt: '2026-10-02T00:00:00Z',
      value: 5,
      currency: 'USD',
      userRef: 'owner-1',
    })
  })

  it('falls back to the stored currency and handles zero-decimal amounts', async () => {
    const { admin } = fakeAdmin({
      organization_members: members,
      billing_transactions: [{ ...stored, currency: 'KRW' }],
    })
    await sendRefundToHub(admin, adjustment({ currency_code: null, totals: { total: '29000' } }))
    expect(sentEvent()).toMatchObject({ value: 29000, currency: 'KRW' })
  })

  it('sends nothing for a transaction that is not ours (proxy or another service)', async () => {
    const { admin } = fakeAdmin({ organization_members: members, billing_transactions: [] })
    expect(await sendRefundToHub(admin, adjustment())).toBe('done')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a pending refund', { status: 'pending_approval' }],
    ['a rejected refund', { status: 'rejected' }],
    ['a credit', { action: 'credit' }],
    ['a chargeback', { action: 'chargeback' }],
  ])('sends nothing for %s', async (_label, overrides) => {
    const { admin } = fakeAdmin({ organization_members: members, billing_transactions: [stored] })
    await sendRefundToHub(admin, adjustment(overrides))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('account events', () => {
  it('sends activation keyed by user id', async () => {
    await sendActivationToHub('user-1', '2026-10-01T00:00:00.000Z')
    expect(sentEvent()).toEqual({
      eventId: 'activation:user-1',
      name: 'activation',
      occurredAt: '2026-10-01T00:00:00.000Z',
      userRef: 'user-1',
    })
  })

  it('reports a failed activation without throwing', async () => {
    hubAnswers(500, {})
    await expect(sendActivationToHub('user-1', '2026-10-01T00:00:00.000Z')).resolves.toBeUndefined()
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('forgets a person by user id, and a failure keeps that id for a re-send', async () => {
    await forgetHubPerson('user-1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://hub.test/v1/people/user-1')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')

    fetchMock.mockRejectedValue(new Error('down'))
    await expect(forgetHubPerson('user-1')).resolves.toBeUndefined()
    expect(captureException.mock.calls[0][1].extra.id).toBe('user-1')
  })
})

describe('sendDataConnectedToHub', () => {
  function source(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ds1',
      org_id: 'org1',
      created_by: 'user-1',
      engine: 'postgres',
      provider: 'supabase',
      is_demo: false,
      status: 'active',
      deleted_at: null,
      created_at: '2026-10-01T00:00:00Z',
      last_connected_at: '2026-10-01T00:00:05Z',
      ...overrides,
    }
  }

  it('sends the first source dated by its stored created_at, with no personal data', async () => {
    const { admin } = fakeAdmin({ data_sources: [source()] })
    await sendDataConnectedToHub(admin, 'user-1', 'ds1')
    expect(sentEvent()).toEqual({
      eventId: 'data_connected:user-1',
      name: 'data_connected',
      occurredAt: '2026-10-01T00:00:00Z',
      userRef: 'user-1',
      props: { org_id: 'org1', data_source_id: 'ds1', engine: 'postgres', provider: 'supabase' },
    })
  })

  it('repeats identical data when the same source is provisioned again', async () => {
    const { admin, tables } = fakeAdmin({ data_sources: [source()] })
    await sendDataConnectedToHub(admin, 'user-1', 'ds1')
    tables.data_sources[0].last_connected_at = '2026-10-09T00:00:00Z'
    await sendDataConnectedToHub(admin, 'user-1', 'ds1')
    expect(sentEvent(1)).toEqual(sentEvent(0))
  })

  it('stays silent for a later source, even when the first was since removed', async () => {
    const removed = source({ status: 'disabled', deleted_at: '2026-10-02T00:00:00Z' })
    const later = source({ id: 'ds2', created_at: '2026-10-03T00:00:00Z', last_connected_at: '2026-10-03T00:00:05Z' })
    const { admin } = fakeAdmin({ data_sources: [removed, later] })
    await sendDataConnectedToHub(admin, 'user-1', 'ds2')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lets only one of two sources connected at the same moment send', async () => {
    const stamp = { last_connected_at: '2026-10-01T00:00:05Z' }
    const { admin } = fakeAdmin({ data_sources: [source({ id: 'ds2', ...stamp }), source({ id: 'ds1', ...stamp })] })
    await sendDataConnectedToHub(admin, 'user-1', 'ds2')
    expect(fetchMock).not.toHaveBeenCalled()
    await sendDataConnectedToHub(admin, 'user-1', 'ds1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores demo sources and the row a failed credential store left behind', async () => {
    const demo = source({ id: 'demo', is_demo: true, last_connected_at: '2026-09-01T00:00:00Z' })
    const failed = source({ id: 'failed', status: 'error', deleted_at: '2026-09-02T00:00:01Z', last_connected_at: '2026-09-02T00:00:00Z' })
    const { admin } = fakeAdmin({ data_sources: [demo, failed, source()] })
    await sendDataConnectedToHub(admin, 'user-1', 'ds1')
    expect(sentEvent().props.data_source_id).toBe('ds1')
  })

  it("is judged per acting user: a member's first source counts in an org that already has one", async () => {
    const owners = source({ id: 'ds0', created_by: 'owner-1', last_connected_at: '2026-09-01T00:00:00Z' })
    const { admin } = fakeAdmin({ data_sources: [owners, source({ created_by: 'member-1' })] })
    await sendDataConnectedToHub(admin, 'member-1', 'ds1')
    expect(sentEvent().userRef).toBe('member-1')
  })

  it("credits the acting user who heals another member's failed row", async () => {
    const { admin } = fakeAdmin({ data_sources: [source({ created_by: 'owner-1' })] })
    await sendDataConnectedToHub(admin, 'member-1', 'ds1')
    expect(sentEvent().eventId).toBe('data_connected:member-1')
  })

  it('reports a hub failure without throwing', async () => {
    hubAnswers(500, {})
    const { admin } = fakeAdmin({ data_sources: [source()] })
    await expect(sendDataConnectedToHub(admin, 'user-1', 'ds1')).resolves.toBeUndefined()
    expect(captureException.mock.calls[0][1].extra.id).toBe('data_connected:user-1')
  })
})

describe('sendFirstAnalysisToHub', () => {
  function run(overrides: Record<string, unknown> = {}) {
    return {
      id: 'run1',
      org_id: 'org1',
      data_source_id: 'ds1',
      user_id: 'user-1',
      channel: 'web',
      status: 'succeeded',
      ended_at: '2026-10-01T00:00:00Z',
      data_sources: { is_demo: false },
      ...overrides,
    }
  }

  it('sends the first answered question dated by its stored ended_at, without the question text', async () => {
    const { admin } = fakeAdmin({ agent_runs: [run({ question: 'Who churned?' })] })
    await sendFirstAnalysisToHub(admin, 'user-1', 'run1')
    expect(sentEvent()).toEqual({
      eventId: 'first_analysis:user-1',
      name: 'first_analysis',
      occurredAt: '2026-10-01T00:00:00Z',
      userRef: 'user-1',
      props: { org_id: 'org1', data_source_id: 'ds1', run_id: 'run1', channel: 'web' },
    })
  })

  it('stays silent for a later run', async () => {
    const { admin } = fakeAdmin({ agent_runs: [run(), run({ id: 'run2', ended_at: '2026-10-02T00:00:00Z' })] })
    await sendFirstAnalysisToHub(admin, 'user-1', 'run2')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a demo source', { data_sources: { is_demo: true } }],
    ['a removed source link', { data_sources: null }],
    ['a monitor drafting run', { channel: 'monitor' }],
    ['a failed run', { status: 'failed' }],
    ["another user's run", { user_id: 'user-2' }],
  ])('does not count %s as first', async (_label, overrides) => {
    const earlier = run({ id: 'run0', ended_at: '2026-09-01T00:00:00Z', ...overrides })
    const { admin } = fakeAdmin({ agent_runs: [earlier, run()] })
    await sendFirstAnalysisToHub(admin, 'user-1', 'run1')
    expect(sentEvent().props.run_id).toBe('run1')
  })

  it('sends nothing when the run itself is on a demo source', async () => {
    const { admin } = fakeAdmin({ agent_runs: [run({ data_sources: { is_demo: true } })] })
    await sendFirstAnalysisToHub(admin, 'user-1', 'run1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads a run older than the channel column as web, and counts MCP', async () => {
    const { admin } = fakeAdmin({ agent_runs: [run({ channel: null })] })
    await sendFirstAnalysisToHub(admin, 'user-1', 'run1')
    expect(sentEvent().props.channel).toBe('web')

    const mcp = fakeAdmin({ agent_runs: [run({ channel: 'mcp' })] })
    await sendFirstAnalysisToHub(mcp.admin, 'user-1', 'run1')
    expect(sentEvent(1).props.channel).toBe('mcp')
  })

  it('reports a hub failure without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    const { admin } = fakeAdmin({ agent_runs: [run()] })
    await expect(sendFirstAnalysisToHub(admin, 'user-1', 'run1')).resolves.toBeUndefined()
    expect(captureException.mock.calls[0][1].extra.id).toBe('first_analysis:user-1')
  })
})
