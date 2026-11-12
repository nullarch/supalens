import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pins for the content-agent enqueue seams:
 * - a COMPLETE no-op (zero DB calls) when CONTENT_AGENT_TRACKING_* is unset
 * - org creation: attribution first (insert-or-ignore on org_id), then `signup:<orgId>` carrying it
 * - every outbox write is insert-or-ignore on event_id (first enqueue wins — ids never re-minted)
 * - own_db_connected only for the org's FIRST own source to connect
 * - Paddle: payment keyed on the txn id; refund resolved through billing_transactions (proxy → nothing)
 * - never throws
 */

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => null }))

import { anonymousIdForOrg, encodeVariantCookie } from './logic'
import { enqueueContentAgentEvent, recordContentAgentOrgCreated, recordOwnDbConnected, recordPaddlePayment, recordPaddleRefund } from './events'

type Call = { table: string; op: string; args: unknown[] }
let calls: Call[] = []
let results: Record<string, { data: unknown; error: unknown }> = {}
let throwOn: string | null = null

function fakeAdmin(): SupabaseClient {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'neq', 'not', 'is', 'in', 'lte', 'order', 'limit', 'upsert', 'insert', 'update']) {
      b[op] = (...args: unknown[]) => {
        calls.push({ table, op, args })
        return b
      }
    }
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      (throwOn === table
        ? Promise.reject(new Error('PRIVATE_DB_FAILURE'))
        : Promise.resolve(results[table] ?? { data: [], error: null })
      ).then(resolve, reject)
    return b
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient
}

const ops = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op)
const outboxRows = () => ops('content_agent_outbox', 'upsert').map((c) => c.args[0] as Record<string, unknown>)

const ORG = '11111111-2222-4333-8444-555555555555'
const VARIANT = '0f8e2a4c-1b2d-4e5f-8a9b-0c1d2e3f4a5b'
const CAMPAIGN = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'

beforeEach(() => {
  calls = []
  results = {}
  throwOn = null
  process.env.CONTENT_AGENT_TRACKING_URL = 'https://track.example.com/tracking/supalens/events'
  process.env.CONTENT_AGENT_TRACKING_TOKEN = 'tok'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
})

afterEach(() => {
  delete process.env.CONTENT_AGENT_TRACKING_URL
  delete process.env.CONTENT_AGENT_TRACKING_TOKEN
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})

describe('env gate', () => {
  it('does nothing at all when unconfigured', async () => {
    delete process.env.CONTENT_AGENT_TRACKING_TOKEN
    const admin = fakeAdmin()
    const cookieValue = encodeVariantCookie({ variantId: VARIANT, campaignId: null, capturedAt: '2026-09-25T00:00:00.000Z' })
    await recordContentAgentOrgCreated({ orgId: ORG, cookieValue, admin })
    await recordOwnDbConnected({ orgId: ORG, dataSourceId: 'ds-1', admin })
    await recordPaddlePayment({ orgId: ORG, txn: { id: 'txn_1', status: 'completed', currency_code: 'USD', details: { totals: { grand_total: '8900' } } }, admin })
    await recordPaddleRefund({ adj: { id: 'adj_1', action: 'refund', transaction_id: 'txn_1' }, admin })
    await expect(enqueueContentAgentEvent({ orgId: ORG, eventId: 'e', name: 'signup', occurredAt: new Date() }, { admin })).resolves.toBe(false)
    expect(calls).toEqual([])
  })
  it('treats a non-https endpoint as unconfigured', async () => {
    process.env.CONTENT_AGENT_TRACKING_URL = 'http://track.example.com/tracking/supalens/events'
    const admin = fakeAdmin()
    await recordContentAgentOrgCreated({ orgId: ORG, admin })
    expect(calls).toEqual([])
  })
})

describe('recordContentAgentOrgCreated', () => {
  it('persists first-touch attribution, then enqueues signup carrying the variant + anonymousId', async () => {
    results.content_agent_attribution = { data: [{ variant_id: VARIANT, campaign_id: CAMPAIGN }], error: null }
    const cookieValue = encodeVariantCookie({ variantId: VARIANT, campaignId: CAMPAIGN, capturedAt: '2026-09-24T12:00:00.000Z' })
    await recordContentAgentOrgCreated({ orgId: ORG, cookieValue, admin: fakeAdmin() })

    const [attr] = ops('content_agent_attribution', 'upsert')
    expect(attr.args).toEqual([
      { org_id: ORG, variant_id: VARIANT, campaign_id: CAMPAIGN, captured_at: '2026-09-24T12:00:00.000Z' },
      { onConflict: 'org_id', ignoreDuplicates: true },
    ])
    // attribution is written BEFORE the event is built
    const attrIdx = calls.findIndex((c) => c.table === 'content_agent_attribution' && c.op === 'upsert')
    const outboxIdx = calls.findIndex((c) => c.table === 'content_agent_outbox' && c.op === 'upsert')
    expect(attrIdx).toBeLessThan(outboxIdx)

    const [row] = outboxRows()
    expect(row).toMatchObject({ event_id: `signup:${ORG}`, name: 'signup', org_id: ORG })
    expect(row.payload).toMatchObject({
      eventId: `signup:${ORG}`,
      name: 'signup',
      variantId: VARIANT,
      campaignId: CAMPAIGN,
      anonymousId: anonymousIdForOrg(ORG, 'service-key'),
    })
    expect((row.payload as { occurredAt: string }).occurredAt).toMatch(/Z$/)
    expect(ops('content_agent_outbox', 'upsert')[0].args[1]).toEqual({ onConflict: 'event_id', ignoreDuplicates: true })
  })

  it('no / tampered cookie → no attribution row, signup still enqueued without variant fields', async () => {
    await recordContentAgentOrgCreated({ orgId: ORG, cookieValue: `v1.${VARIANT}.junk.1790000000`, admin: fakeAdmin() })
    expect(ops('content_agent_attribution', 'upsert')).toHaveLength(0)
    const payload = outboxRows()[0].payload as Record<string, unknown>
    expect(payload).not.toHaveProperty('variantId')
    expect(payload).not.toHaveProperty('campaignId')
    expect(payload.eventId).toBe(`signup:${ORG}`)
  })

  it('never throws (attribution + outbox failures are swallowed)', async () => {
    throwOn = 'content_agent_attribution'
    const cookieValue = encodeVariantCookie({ variantId: VARIANT, campaignId: null, capturedAt: '2026-09-25T00:00:00.000Z' })
    await expect(recordContentAgentOrgCreated({ orgId: ORG, cookieValue, admin: fakeAdmin() })).resolves.toBeUndefined()
    throwOn = 'content_agent_outbox'
    await expect(recordContentAgentOrgCreated({ orgId: ORG, admin: fakeAdmin() })).resolves.toBeUndefined()
  })
})

describe('recordOwnDbConnected', () => {
  it("enqueues own_db_connected:<orgId> for the org's first own source", async () => {
    await recordOwnDbConnected({ orgId: ORG, dataSourceId: 'ds-1', admin: fakeAdmin() })
    // the "first" check: other non-demo sources of this org that ever connected (incl. soft-deleted)
    expect(calls).toContainEqual({ table: 'data_sources', op: 'eq', args: ['is_demo', false] })
    expect(calls).toContainEqual({ table: 'data_sources', op: 'neq', args: ['id', 'ds-1'] })
    expect(calls).toContainEqual({ table: 'data_sources', op: 'not', args: ['last_connected_at', 'is', null] })
    expect(calls.some((c) => c.table === 'data_sources' && c.op === 'is' && c.args[0] === 'deleted_at')).toBe(false)
    expect(outboxRows()[0]).toMatchObject({ event_id: `own_db_connected:${ORG}`, name: 'own_db_connected' })
  })
  it('stays silent when the org already had a connected own source', async () => {
    results.data_sources = { data: [{ id: 'ds-0' }], error: null }
    await recordOwnDbConnected({ orgId: ORG, dataSourceId: 'ds-1', admin: fakeAdmin() })
    expect(outboxRows()).toHaveLength(0)
  })
  it('never throws — a lookup failure just skips', async () => {
    throwOn = 'data_sources'
    await expect(recordOwnDbConnected({ orgId: ORG, dataSourceId: 'ds-1', admin: fakeAdmin() })).resolves.toBeUndefined()
    expect(outboxRows()).toHaveLength(0)
  })
})

describe('Paddle events', () => {
  it('payment → subscription_payment:<txn> with a decimal value', async () => {
    await recordPaddlePayment({
      orgId: ORG,
      txn: { id: 'txn_1', status: 'completed', currency_code: 'KRW', details: { totals: { grand_total: '120000' } }, billed_at: '2026-09-24T10:00:00Z' },
      admin: fakeAdmin(),
    })
    expect(outboxRows()[0].payload).toMatchObject({
      eventId: 'subscription_payment:txn_1',
      name: 'subscription_payment',
      occurredAt: '2026-09-24T10:00:00.000Z',
      value: 120000,
      currency: 'KRW',
    })
  })
  it('refund resolves the org via billing_transactions', async () => {
    results.billing_transactions = { data: [{ org_id: ORG, currency: 'USD' }], error: null }
    await recordPaddleRefund({
      adj: { id: 'adj_1', action: 'refund', status: 'approved', transaction_id: 'txn_1', totals: { total: '8900' }, updated_at: '2026-09-25T01:00:00Z' },
      admin: fakeAdmin(),
    })
    expect(calls).toContainEqual({ table: 'billing_transactions', op: 'eq', args: ['paddle_transaction_id', 'txn_1'] })
    expect(outboxRows()[0]).toMatchObject({ event_id: 'refund:adj_1', org_id: ORG })
    expect(outboxRows()[0].payload).toMatchObject({ name: 'refund', value: 89, currency: 'USD' })
  })
  it('a proxy (partner) adjustment has no billing_transactions row → nothing', async () => {
    await recordPaddleRefund({ adj: { id: 'adj_2', action: 'refund', transaction_id: 'txn_proxy' }, admin: fakeAdmin() })
    expect(outboxRows()).toHaveLength(0)
  })
})
