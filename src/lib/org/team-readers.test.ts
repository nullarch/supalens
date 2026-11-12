import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
import { listOrgMembers, listPendingInvitations } from './server'

function clientFor(result: { data: unknown; error: unknown }) {
  const steps: Array<[string, ...unknown[]]> = []
  const builder = {
    select: (...args: unknown[]) => { steps.push(['select', ...args]); return builder },
    eq: (...args: unknown[]) => { steps.push(['eq', ...args]); return builder },
    order: async (...args: unknown[]) => { steps.push(['order', ...args]); return result },
  }
  const rpc = vi.fn().mockResolvedValue(result)
  const from = vi.fn(() => builder)
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, from, steps }
}

describe('team readers distinguish unavailable from empty', () => {
  for (const [name, read] of [['members', listOrgMembers], ['invitations', listPendingInvitations]] as const) {
    it(`${name}: keeps a successful empty result`, async () => {
      const { client } = clientFor({ data: [], error: null })
      await expect(read(client, 'sample-org')).resolves.toEqual([])
    })
    for (const result of [{ data: null, error: { code: '42501', message: 'private database details' } }, { data: null, error: null }, { data: {}, error: null }]) {
      it(`${name}: throws rather than making an empty-state claim on unavailable data`, async () => {
        const { client } = clientFor(result)
        await expect(read(client, 'sample-org')).rejects.toThrow(name === 'members' ? 'team_members_unavailable' : 'team_invitations_unavailable')
      })
    }
  }
  it('retains the org-scoped member RPC and stored field mapping', async () => {
    const { client, rpc } = clientFor({ data: [{ user_id: 'sample-user', email: 'sample@example.com', display_name: 'Sample', role: 'member', created_at: '2026-09-01T00:00:00Z' }], error: null })
    await expect(listOrgMembers(client, 'sample-org')).resolves.toEqual([{ userId: 'sample-user', email: 'sample@example.com', displayName: 'Sample', role: 'member', joinedAt: '2026-09-01T00:00:00Z' }])
    expect(rpc).toHaveBeenCalledWith('list_org_members', { p_org: 'sample-org' })
  })
  it('retains invitation tenant/status filters and stored field mapping', async () => {
    const { client, from, steps } = clientFor({ data: [{ id: 'sample-invite', email: 'sample@example.com', role: 'member', created_at: '2026-09-01', expires_at: '2026-09-14' }], error: null })
    await expect(listPendingInvitations(client, 'sample-org')).resolves.toEqual([{ id: 'sample-invite', email: 'sample@example.com', role: 'member', createdAt: '2026-09-01', expiresAt: '2026-09-14' }])
    expect(from).toHaveBeenCalledWith('organization_invitations')
    expect(steps).toContainEqual(['eq', 'org_id', 'sample-org'])
    expect(steps).toContainEqual(['eq', 'status', 'pending'])
  })
})
