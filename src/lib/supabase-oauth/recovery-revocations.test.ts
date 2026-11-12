import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), reveal: vi.fn(), revoke: vi.fn(), grant: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: mocks.admin }))
vi.mock('@/lib/secrets/service', () => ({ revealSecret: mocks.reveal, revokeSecret: mocks.revoke }))
vi.mock('./client', () => ({ revokeGrant: mocks.grant }))
vi.mock('./tokens', () => ({ getValidAccessToken: vi.fn(), isReconnectRequired: () => false }))
vi.mock('@/lib/supabase-management/client', () => ({ SupabaseManagementClient: vi.fn() }))
vi.mock('@/lib/supabase-management/bootstrap', () => ({ dropReadonlyRole: vi.fn() }))
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }))
import { processPendingRevocations } from './revocations'

type Reply = { data: unknown; error: unknown; count?: number }
const ok = (data: unknown): Reply => ({ data, error: null })
let replies: Reply[]
const queries: { table: string; calls: unknown[][] }[] = []
function from(table: string) {
  const calls: unknown[][] = []; queries.push({ table, calls })
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'limit', 'update', 'order']) builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder }
  builder.then = (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) => (replies.length ? Promise.resolve(replies.shift()!) : Promise.reject(new Error('Unexpected DB call'))).then(resolve, reject)
  return builder
}
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0; mocks.admin.mockReturnValue({ from }); mocks.reveal.mockResolvedValue('SAMPLE_OLD_REFRESH')
  replies = [ok([{ id: 'row-a', org_id: 'org-a', connection_id: 'connection-a', kind: 'oauth_grant', attempts: 0, payload: { secret_id: 'old-secret' } }]), ok([{ id: 'old-secret' }]), ok([{ id: 'row-a' }]), { data: null, error: null, count: 0 }, ok([])]
})
describe('revocation work must not consume a replacement grant', () => {
  it('revokes only the pinned current secret of a revoked parent', async () => {
    expect(await processPendingRevocations()).toEqual({ processed: 1, done: 1, failed: 0, retried: 0 })
    expect(mocks.reveal).toHaveBeenCalledWith('old-secret', expect.anything())
    expect(mocks.grant).toHaveBeenCalledWith('SAMPLE_OLD_REFRESH')
    for (const query of queries.filter(q => q.table === 'secrets')) {
      expect(query.calls).toContainEqual(['eq', 'provider_connections.status', 'revoked'])
      expect(query.calls).toContainEqual(['eq', 'is_current', true])
      expect(query.calls[0][1]).toContain('provider_connections!inner(status)')
    }
    expect(queries[1].calls).toContainEqual(['eq', 'org_id', 'org-a'])
  })
  it('does not revoke a different replacement secret', async () => { replies[1] = ok([{ id: 'new-secret' }]); await processPendingRevocations(); expect(mocks.reveal).not.toHaveBeenCalled(); expect(mocks.grant).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled() })
  it('does not consume a grant when the parent is no longer revoked', async () => { replies[1] = ok([]); await processPendingRevocations(); expect(mocks.reveal).not.toHaveBeenCalled(); expect(mocks.grant).not.toHaveBeenCalled() })
  it('keeps legacy cleanup rows subject to the revoked-parent join', async () => { replies[0] = ok([{ id: 'legacy', org_id: 'org-a', connection_id: 'connection-a', kind: 'oauth_grant', attempts: 0, payload: null }]); replies[1] = ok([]); await processPendingRevocations(); expect(mocks.grant).not.toHaveBeenCalled() })
})
