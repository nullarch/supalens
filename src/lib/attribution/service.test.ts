import { beforeEach, describe, expect, it, vi } from 'vitest'

// Chainable fake of the service-role client: every builder method records the call and returns the
// builder; awaiting it resolves to the canned result for that table (or throws when asked to).
type Call = { table: string; op: string; args: unknown[] }
const calls: Call[] = []
const results: Record<string, { data: unknown; error: unknown }> = {}
let throwOn: string | null = null

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'is', 'limit', 'insert', 'update']) {
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

vi.mock('server-only', () => ({}))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
import { recordRefClick, recordRefConversion } from './service'

const ops = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op)

beforeEach(() => {
  calls.length = 0
  for (const k of Object.keys(results)) delete results[k]
  throwOn = null
})

describe('recordRefClick', () => {
  it('a live campaign code matches (cookie gets set) and logs the click', async () => {
    results.outreach_campaigns = { data: [{ id: 'camp-1' }], error: null }
    await expect(recordRefClick({ refCode: 'CampA123', visitorHash: 'h' })).resolves.toEqual({ matched: true })
    expect(ops('outreach_clicks', 'insert')[0].args[0]).toMatchObject({ ref_code: 'CampA123', lead_id: null })
    // only a LIVE campaign counts
    expect(calls).toContainEqual({ table: 'outreach_campaigns', op: 'is', args: ['deleted_at', null] })
  })
  it('an unknown code still logs the click but does not match', async () => {
    await expect(recordRefClick({ refCode: 'Nobody12', visitorHash: 'h' })).resolves.toEqual({ matched: false })
    expect(ops('outreach_clicks', 'insert')).toHaveLength(1)
  })
  it('never throws — a DB failure just reports no match', async () => {
    throwOn = 'outreach_clicks'
    await expect(recordRefClick({ refCode: 'CampA123', visitorHash: 'h' })).resolves.toEqual({ matched: false })
  })
})

describe('recordRefConversion', () => {
  const args = { refCode: 'CampA123', userId: 'user-1', orgId: 'org-1' }

  it('credits the campaign that owns the code', async () => {
    results.outreach_campaigns = { data: [{ id: 'camp-1' }], error: null }
    await recordRefConversion(args)
    expect(ops('outreach_campaign_conversions', 'insert')[0].args[0]).toEqual({
      campaign_id: 'camp-1',
      user_id: 'user-1',
      org_id: 'org-1',
    })
  })
  it('unknown / archived campaign codes credit nothing', async () => {
    await recordRefConversion(args)
    expect(ops('outreach_campaign_conversions', 'insert')).toHaveLength(0)
  })
  it('a duplicate credit (unique violation) is a silent no-op', async () => {
    results.outreach_campaigns = { data: [{ id: 'camp-1' }], error: null }
    results.outreach_campaign_conversions = { data: null, error: { code: '23505', message: 'duplicate key' } }
    await expect(recordRefConversion(args)).resolves.toBeUndefined()
  })
  it('rejects a malformed cookie value before touching the DB, and never throws', async () => {
    await recordRefConversion({ ...args, refCode: '../../etc' })
    expect(calls).toHaveLength(0)
    throwOn = 'outreach_campaigns'
    await expect(recordRefConversion(args)).resolves.toBeUndefined()
  })
})
