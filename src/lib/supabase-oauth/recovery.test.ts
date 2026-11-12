import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: vi.fn(), admin: vi.fn(), put: vi.fn(), projects: vi.fn(), invalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/org/require-role', () => ({ userHasOrgRole: mocks.role }))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: mocks.admin }))
vi.mock('@/lib/secrets/service', () => ({ putSecret: mocks.put }))
vi.mock('@/lib/supabase-management/client', () => ({ SupabaseManagementClient: class { listProjects = mocks.projects } }))
vi.mock('./tokens', () => ({ invalidateAccessToken: mocks.invalidate }))
import { reauthorizeConnection } from './recovery'

type Reply = { data: unknown; error: unknown }
const ok = (data: unknown): Reply => ({ data, error: null })
let replies: Reply[]
const queries: { table: string; calls: unknown[][] }[] = []
function from(table: string) {
  const calls: unknown[][] = []; queries.push({ table, calls })
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'limit', 'update']) builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder }
  builder.then = (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) => (replies.length ? Promise.resolve(replies.shift()!) : Promise.reject(new Error('Unexpected DB call'))).then(resolve, reject)
  return builder
}
const db = { from } as unknown as Parameters<typeof reauthorizeConnection>[0]
const target = { id: 'connection-a', org_id: 'org-a', status: 'revoked', refresh_generation: 8 }
const tokens = { accessToken: 'SAMPLE_ACCESS', refreshToken: 'SAMPLE_REFRESH', expiresIn: 3600, tokenType: 'bearer' }
const run = () => reauthorizeConnection(db, 'user-a', 'connection-a', 'org-a', tokens)
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0
  mocks.admin.mockReturnValue(db); mocks.role.mockResolvedValue(true); mocks.put.mockResolvedValue('new-secret')
  mocks.projects.mockResolvedValue([{ id: 'project-a' }, { id: 'project-b' }])
  replies = [ok([target]), ok([{ projectRef: 'project-a' }, { projectRef: 'project-b' }]), ok([]), ok([{ id: target.id }]), ok([{ id: target.id }])]
})
describe('reauthorize the existing connection; no provider or database IO', () => {
  it('keeps identities and installs a replacement under tenant-scoped generation CAS', async () => {
    await expect(run()).resolves.toBeUndefined()
    expect(mocks.role).toHaveBeenCalledExactlyOnceWith(db, 'org-a', 'user-a')
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith({ orgId: 'org-a', kind: 'oauth_refresh_token', plaintext: 'SAMPLE_REFRESH', parent: { connectionId: 'connection-a' }, actor: { kind: 'user', id: 'user-a' } })
    expect(queries[3].calls).toContainEqual(['eq', 'refresh_generation', 8])
    expect(queries[4].calls).toContainEqual(['eq', 'refresh_generation', 9])
    for (const query of queries.slice(1)) expect(query.calls).toContainEqual(['eq', 'org_id', 'org-a'])
    // First RLS lookup is scoped by globally unique id; org is taken from that row.
  })
  it('rejects denied roles before requesting service-role access or provider projects', async () => { mocks.role.mockResolvedValue(false); await expect(run()).rejects.toMatchObject({ reason: 'denied' }); expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.projects).not.toHaveBeenCalled() })
  it('rejects a callback from a different workspace', async () => { replies[0] = ok([{ ...target, org_id: 'other-org' }]); await expect(run()).rejects.toMatchObject({ reason: 'denied' }); expect(mocks.put).not.toHaveBeenCalled() })
  it.each(['pending', 'disabled'])('refuses a busy/unrecoverable connection (%s)', async status => { replies[0] = ok([{ ...target, status }]); await expect(run()).rejects.toMatchObject({ reason: 'changed' }); expect(mocks.put).not.toHaveBeenCalled() })
  it('accepts expired connections as recoverable', async () => { replies[0] = ok([{ ...target, status: 'expired' }]); await expect(run()).resolves.toBeUndefined() })
  it('fails closed when a linked project is outside the new grant', async () => { mocks.projects.mockResolvedValue([{ id: 'project-a' }]); await expect(run()).rejects.toMatchObject({ reason: 'projectMismatch' }); expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled() })
  it('fails closed for missing project metadata', async () => { replies[1] = ok([{ projectRef: null }]); await expect(run()).rejects.toMatchObject({ reason: 'projectMismatch' }); expect(mocks.put).not.toHaveBeenCalled() })
  it('does not reconnect without a linked source to verify', async () => { replies[1] = ok([]); await expect(run()).rejects.toMatchObject({ reason: 'unavailable' }); expect(mocks.put).not.toHaveBeenCalled() })
  it('does not race pending credential cleanup', async () => { replies[2] = ok([{ id: 'old-cleanup' }]); await expect(run()).rejects.toMatchObject({ reason: 'cleanupPending' }); expect(mocks.put).not.toHaveBeenCalled() })
  it('does not save a token after losing the claim', async () => { replies[3] = ok([]); await expect(run()).rejects.toMatchObject({ reason: 'changed' }); expect(mocks.put).not.toHaveBeenCalled() })
  it('does not claim success when final persistence is unconfirmed', async () => { replies[4] = { data: null, error: { message: 'PRIVATE_STORAGE_ERROR' } }; replies.push(ok([])); await expect(run()).rejects.toMatchObject({ reason: 'unconfirmed' }); expect(queries.at(-1)?.calls[0]).toEqual(['update', { status: 'error' }]) })
})
