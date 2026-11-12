import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), meta: vi.fn(), reveal: vi.fn(), cas: vi.fn(), revoke: vi.fn(), refresh: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: mocks.admin }))
vi.mock('@/lib/secrets/service', () => ({ getCurrentSecret: mocks.meta, revealSecret: mocks.reveal, casUpdateSecret: mocks.cas, revokeSecret: mocks.revoke }))
vi.mock('./client', async original => ({ ...await original<object>(), refreshTokens: mocks.refresh }))
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }))
import { getCachedAccessToken, getValidAccessToken, invalidateAccessToken } from './tokens'
import { OAuthError } from './client'

type Reply = { data: unknown; error: unknown }
const ok = (data: unknown): Reply => ({ data, error: null })
let replies: Reply[]
const queries: { table: string; calls: unknown[][] }[] = []
const conn = { id: 'connection-a', org_id: 'org-a', status: 'active', refresh_generation: 3, prev_refresh_hash: null }
function from(table: string) {
  const calls: unknown[][] = []; queries.push({ table, calls })
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'limit', 'update', 'insert']) builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder }
  builder.then = (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) => (replies.length ? Promise.resolve(replies.shift()!) : Promise.reject(new Error('Unexpected DB call'))).then(resolve, reject)
  return builder
}
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0; invalidateAccessToken(conn.id)
  mocks.admin.mockReturnValue({ from }); mocks.meta.mockReset(); mocks.refresh.mockReset()
  mocks.meta.mockResolvedValue({ id: 'old-secret', orgId: 'org-a', version: 4 })
  mocks.reveal.mockResolvedValue('SAMPLE_REFRESH'); mocks.cas.mockResolvedValue(5)
  mocks.refresh.mockResolvedValue({ accessToken: 'SAMPLE_ACCESS', refreshToken: 'SAMPLE_NEXT', expiresIn: 3600 })
  replies = [ok([conn]), ok([{ id: conn.id }])]
})
describe('rotation/reauthorization boundaries with mocked credentials', () => {
  it('records rotation only under the original tenant/generation/status', async () => {
    expect(await getValidAccessToken(conn.id)).toEqual({ accessToken: 'SAMPLE_ACCESS', expiresIn: 3600 })
    expect(queries[1].calls).toContainEqual(['eq', 'org_id', 'org-a'])
    expect(queries[1].calls).toContainEqual(['eq', 'refresh_generation', 3])
    expect(queries[1].calls).toContainEqual(['eq', 'status', 'active'])
    expect(queries[1].calls.at(-1)).toEqual(['select', 'id'])
  })
  it('does not rotate during a recovery claim', async () => { replies = [ok([{ ...conn, status: 'pending' }])]; await expect(getValidAccessToken(conn.id)).rejects.toThrow('being updated'); expect(mocks.refresh).not.toHaveBeenCalled() })
  it('does not acknowledge a rotation whose parent write was unconfirmed', async () => { replies[1] = { data: null, error: new Error('write unavailable') }; await expect(getValidAccessToken(conn.id)).rejects.toThrow('write unavailable') })
  it('rereads the connection after losing the parent CAS', async () => { replies = [ok([conn]), ok([]), ok([{ ...conn, status: 'pending', refresh_generation: 4 }])]; await expect(getValidAccessToken(conn.id)).rejects.toThrow('being updated'); expect(mocks.revoke).not.toHaveBeenCalled() })
  it('treats a new secret ID with a reset version as reauthorization, not revoke', async () => {
    mocks.meta.mockResolvedValueOnce({ id: 'old-secret', orgId: 'org-a', version: 8 }).mockResolvedValue({ id: 'new-secret', orgId: 'org-a', version: 1 })
    mocks.refresh.mockRejectedValueOnce(new OAuthError('No such refresh token found', 404)).mockResolvedValue({ accessToken: 'NEW_ACCESS', refreshToken: 'NEW_REFRESH', expiresIn: 3600 })
    replies = [ok([conn]), ok([{ ...conn, refresh_generation: 4 }]), ok([{ id: conn.id }])]
    expect(await getValidAccessToken(conn.id)).toMatchObject({ accessToken: 'NEW_ACCESS' })
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(queries.some(query => query.table === 'credential_revocations')).toBe(false)
  })
  it('single-flights same-process concurrent callers', async () => {
    expect(await Promise.all([getCachedAccessToken(conn.id), getCachedAccessToken(conn.id)])).toEqual(['SAMPLE_ACCESS', 'SAMPLE_ACCESS'])
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
  it('does not recache an invalidated in-flight token', async () => {
    let release!: (value: unknown) => void
    mocks.refresh.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = getCachedAccessToken(conn.id)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    invalidateAccessToken(conn.id)
    release({ accessToken: 'STALE_ACCESS', refreshToken: 'SAMPLE_NEXT', expiresIn: 3600 })
    await expect(pending).rejects.toThrow('changed during refresh')
    replies = [ok([conn]), ok([{ id: conn.id }])]
    expect(await getCachedAccessToken(conn.id)).toBe('SAMPLE_ACCESS')
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })
})
