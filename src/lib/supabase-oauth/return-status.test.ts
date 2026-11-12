import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({ createClient: mocks.create }))
import { GET } from '@/app/api/connect-supabase/status/route'

const id = '00000000-0000-4000-8000-000000000001'
const calls: unknown[][] = []
let replies: unknown[]
const db = {
  auth: { getUser: vi.fn() },
  from(table: string) {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'is', 'limit']) query[method] = (...args: unknown[]) => { calls.push([table, method, ...args]); return query }
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(replies.shift()).then(resolve)
    return query
  },
}
const run = (connectionId = id) => GET(new Request(`https://sample.invalid/api/connect-supabase/status?connectionId=${connectionId}`))
beforeEach(() => {
  calls.length = 0; vi.clearAllMocks()
  mocks.create.mockResolvedValue(db)
  db.auth.getUser.mockResolvedValue({ data: { user: { id: 'sample-user' } }, error: null })
  replies = [{ data: [{ id, org_id: 'sample-org', status: 'active' }], error: null }, { count: 4, error: null }]
})
describe('OAuth return status reads only RLS-visible metadata', () => {
  it('returns safe counts with no-store and scopes sources to the visible connection org', async () => {
    const response = await run()
    expect(await response.json()).toEqual({ status: 'active', activeSources: 4 })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(calls).toContainEqual(['provider_connections', 'eq', 'id', id])
    expect(calls).toContainEqual(['provider_connections', 'is', 'deleted_at', null])
    expect(calls).toContainEqual(['data_sources', 'eq', 'org_id', 'sample-org'])
    expect(JSON.stringify(calls)).not.toMatch(/secret|token|config|update|insert|rpc/)
  })
  it('does not reveal another tenant or deleted connection', async () => {
    replies[0] = { data: [], error: null }
    expect((await run()).status).toBe(404)
    expect(calls.some(call => call[0] === 'data_sources')).toBe(false)
  })
  it('requires a valid session', async () => {
    db.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await run()).status).toBe(401); expect(calls).toEqual([])
  })
  it('rejects malformed ids before accessing the database', async () => {
    expect((await run('invalid')).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each([0, 1])('does not turn a failed metadata read into success (%s)', async index => {
    replies[index] = { data: null, count: null, error: { message: 'PRIVATE' } }
    const response = await run()
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'unavailable' })
  })
})
