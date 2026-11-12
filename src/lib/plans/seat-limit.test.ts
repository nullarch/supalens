import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Billing invariant: the seat cap counts members + LIVE pending invites only.
 * Nothing auto-revokes an expired invitation, so if expired rows counted, a
 * few stale invites would block a capped org from ever inviting again.
 */

const state = {
  memberCount: 0,
  invites: [] as Array<{ org_id: string; status: string; expires_at: string }>,
}

/** Thenable filter chain over the invite fixtures — count reflects applied filters. */
function invitationBuilder() {
  let rows = state.invites.slice()
  const b = {
    select: () => b,
    eq: (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col as keyof (typeof rows)[number]] === val)
      return b
    },
    gt: (col: string, val: string) => {
      rows = rows.filter((r) => r[col as keyof (typeof rows)[number]] > val)
      return b
    },
    then: (resolve: (v: unknown) => void) => resolve({ count: rows.length, error: null }),
  }
  return b
}

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'organizations') {
        return { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ plan: 'basic' }], error: null }) }) }) }
      }
      if (table === 'organization_members') {
        return {
          select: () => ({
            eq: () => ({ then: (resolve: (v: unknown) => void) => resolve({ count: state.memberCount, error: null }) }),
          }),
        }
      }
      if (table === 'organization_invitations') {
        return { select: () => invitationBuilder() }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

vi.mock('@/lib/paddle/sync', () => ({ reconcileOrgSubscription: vi.fn() }))

const HOUR = 60 * 60 * 1000
const past = new Date(Date.now() - HOUR).toISOString()
const future = new Date(Date.now() + HOUR).toISOString()

beforeEach(() => {
  vi.resetModules()
  process.env.PADDLE_API_KEY = 'test-key' // seat cap only enforces when billing is active
  state.memberCount = 0
  state.invites = []
})

afterEach(() => {
  delete process.env.PADDLE_API_KEY
})

describe('enforceSeatLimit (basic plan: 5 seats)', () => {
  it('does not count expired pending invites toward the cap', async () => {
    state.memberCount = 2
    state.invites = [
      { org_id: 'org1', status: 'pending', expires_at: past },
      { org_id: 'org1', status: 'pending', expires_at: past },
      { org_id: 'org1', status: 'pending', expires_at: future },
    ]
    const { enforceSeatLimit } = await import('./usage')
    // live usage = 2 members + 1 live invite = 3 < 5; counting expired would read 5 >= 5
    expect((await enforceSeatLimit('org1')).ok).toBe(true)
  })

  it('still blocks when members + live invites reach the cap', async () => {
    state.memberCount = 2
    state.invites = [
      { org_id: 'org1', status: 'pending', expires_at: future },
      { org_id: 'org1', status: 'pending', expires_at: future },
      { org_id: 'org1', status: 'pending', expires_at: future },
    ]
    const { enforceSeatLimit } = await import('./usage')
    const res = await enforceSeatLimit('org1')
    expect(res.ok).toBe(false)
  })
})
