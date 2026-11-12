import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), role: vi.fn(), execute: vi.fn(), rate: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/org/require-role', () => ({ userHasOrgRole: mocks.role }))
vi.mock('@/lib/query', () => ({ executeReadOnly: mocks.execute }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rate }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { verifyMonitorRecovery } from './recovery-actions'

type Reply = { data: unknown; error: unknown }
const ok = (data: unknown): Reply => ({ data, error: null })
const id = '00000000-0000-4000-8000-000000000001'
const alert = { id, org_id: 'monitor-org', data_source_id: 'source-a', metric_sql: 'SELECT 3 AS value', type: 'threshold', operator: 'gte', threshold: 1, sensitivity: null, enabled: true, last_checked_at: null, last_error: 'reconnect_required', status: 'firing' }
let replies: Reply[]
const queries: { table: string; calls: unknown[][] }[] = []
function from(table: string) {
  const calls: unknown[][] = []; queries.push({ table, calls })
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'limit', 'update']) builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder }
  builder.then = (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) => (replies.length ? Promise.resolve(replies.shift()!) : Promise.reject(new Error('Unexpected DB call'))).then(resolve, reject)
  return builder
}
const db = { from, auth: { getUser: vi.fn() } }
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0
  db.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-a' } } })
  mocks.createClient.mockResolvedValue(db); mocks.role.mockResolvedValue(true); mocks.rate.mockReturnValue({ allowed: true })
  mocks.execute.mockResolvedValue({ columns: ['value'], rows: [{ value: 3 }], truncated: false })
  replies = [ok([alert]), ok([{ id: 'source-a' }]), ok([{ id }])]
})
describe('explicit manual recovery with mocked IO only', () => {
  it('persists execution metadata only and keeps the monitor tenant and CAS snapshot', async () => {
    const result = await verifyMonitorRecovery(id)
    expect(result).toMatchObject({ ok: true, value: 3, conditionMet: true })
    expect(mocks.role).toHaveBeenCalledWith(db, 'monitor-org', 'user-a', ['owner', 'admin', 'member'])
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('source-a', alert.metric_sql, { actor: { kind: 'user', id: 'user-a' }, maxRows: 1, timeoutMs: 15000 })
    const write = queries.at(-1)!
    expect(write.table).toBe('alerts')
    expect(write.calls[0]).toEqual(['update', { last_error: null, last_value: 3, last_checked_at: expect.any(String) }])
    for (const pair of [['org_id', 'monitor-org'], ['status', 'firing'], ['enabled', true], ['metric_sql', alert.metric_sql], ['last_error', 'reconnect_required']]) expect(write.calls).toContainEqual(['eq', ...pair])
    expect(write.calls).toContainEqual(['is', 'last_checked_at', null])
    expect(queries.map(query => query.table)).toEqual(['alerts', 'data_sources', 'alerts'])
  })
  it('rejects malformed targets without IO', async () => { expect(await verifyMonitorRecovery('bad')).toEqual({ ok: false, reason: 'unavailable' }); expect(mocks.createClient).not.toHaveBeenCalled() })
  it('rejects anonymous callers', async () => { db.auth.getUser.mockResolvedValue({ data: { user: null } }); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason: 'denied' }); expect(queries).toHaveLength(0) })
  it('rejects non-managing members before customer queries', async () => { mocks.role.mockResolvedValue(false); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason: 'denied' }); expect(mocks.execute).not.toHaveBeenCalled() })
  it('does not enable paused monitors', async () => { replies[0] = ok([{ ...alert, enabled: false }]); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason: 'paused' }); expect(mocks.execute).not.toHaveBeenCalled() })
  it('bounds repeated requests before execution', async () => { mocks.rate.mockReturnValue({ allowed: false }); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason: 'retryLater' }); expect(mocks.execute).not.toHaveBeenCalled() })
  it('detects a removed source without attempting a query', async () => { replies[1] = ok([]); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason: 'sourceRemoved' }); expect(mocks.execute).not.toHaveBeenCalled() })
  it.each([['unconfirmed', { data: null, error: { message: 'PRIVATE_SECRET' } }], ['changed', ok([])]])('does not claim persisted recovery on %s', async (reason, reply) => { replies[2] = reply; expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason }); expect(mocks.revalidate).not.toHaveBeenCalled() })
  it('does not expose raw query exceptions', async () => { mocks.execute.mockRejectedValue(new Error('PRIVATE_SECRET')); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason: 'unknown' }); expect(queries).toHaveLength(2) })
  it('recognizes the typed cross-runtime reconnect error', async () => { mocks.execute.mockRejectedValue(Object.assign(new Error('PRIVATE_SECRET'), { name: 'ReconnectRequiredError' })); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason: 'authorization' }) })
  it('requires a finite numeric scalar', async () => { mocks.execute.mockResolvedValue({ columns: ['value'], rows: [{ value: null }] }); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason: 'scalar' }); expect(queries).toHaveLength(2) })
  it.each([['seriesLong', true, [{ value: 1 }]], ['seriesShort', false, []]])('handles anomaly failure %s before saving', async (reason, truncated, rows) => { replies[0] = ok([{ ...alert, type: 'anomaly' }]); mocks.execute.mockResolvedValue({ columns: ['value'], rows, truncated }); expect(await verifyMonitorRecovery(id)).toEqual({ ok: false, reason }); expect(mocks.execute.mock.calls[0][2]).toMatchObject({ maxRows: 2000 }); expect(queries).toHaveLength(2) })
  it('does not turn a revalidation failure into an unacknowledged database write', async () => { mocks.revalidate.mockImplementation(() => { throw new Error('cache') }); expect(await verifyMonitorRecovery(id)).toMatchObject({ ok: true }) })
})
