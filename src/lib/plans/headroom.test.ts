import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Billing invariant: a request that creates MANY rows at once must be capped by how much
 * headroom the plan has left, not by the one-more-row question `enforceResourceLimit` answers.
 *
 * The live hole this pins: the Supabase setup picker provisioned up to 10 data sources per POST
 * without consulting `database_connections` at all, so a free org (cap 1) could tick ten boxes
 * and land ten connections. `resourceHeadroom` is the shared primitive; `withinHeadroom` is the
 * pure split the connect-time auto-bootstrap uses to TRUNCATE (a full cap must never fail an
 * OAuth connect — the grant is real, the extra projects just wait).
 */

const state = { plan: 'free', count: 0 }

/** Thenable filter chain for a `select('*', { count: 'exact', head: true })` row count. */
function countBuilder() {
  const b = {
    eq: () => b,
    is: () => b,
    neq: () => b,
    then: (resolve: (v: unknown) => void) => resolve({ count: state.count, error: null }),
  }
  return b
}

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: (_cols: string, opts?: { head?: boolean }) => {
        // getOrgPlan reads organizations without a count option; every cap reads a head count.
        if (table === 'organizations' && !opts?.head) {
          return { eq: () => ({ limit: async () => ({ data: [{ plan: state.plan }], error: null }) }) }
        }
        return countBuilder()
      },
    }),
  }),
}))

vi.mock('@/lib/paddle/sync', () => ({ reconcileOrgSubscription: vi.fn() }))

const SOURCES = {
  table: 'data_sources',
  label: 'dataSource' as const,
  softDelete: true,
  excludeDemo: true,
  filters: [{ column: 'org_id', value: 'org1' }],
}

beforeEach(() => {
  vi.resetModules()
  process.env.PADDLE_API_KEY = 'test-key'
  state.plan = 'free'
  state.count = 0
})

afterEach(() => {
  delete process.env.PADDLE_API_KEY
})

describe('headroomOf (pure)', () => {
  it('reports null limit AND null remaining when unlimited — never 0', async () => {
    const { headroomOf } = await import('./usage')
    // "no cap" and "no headroom left" must not be confusable: a caller that checked
    // `remaining === 0` would otherwise block every premium org.
    expect(headroomOf(-1, 7)).toEqual({ limit: null, used: 7, remaining: null })
  })

  it('computes what is left, clamped at 0 when already over', async () => {
    const { headroomOf } = await import('./usage')
    expect(headroomOf(3, 1)).toEqual({ limit: 3, used: 1, remaining: 2 })
    expect(headroomOf(1, 1)).toEqual({ limit: 1, used: 1, remaining: 0 })
    expect(headroomOf(1, 5)).toEqual({ limit: 1, used: 5, remaining: 0 }) // grandfathered over-cap org
  })
})

describe('withinHeadroom (pure) — the connect-time truncation', () => {
  it('takes everything when uncapped', async () => {
    const { withinHeadroom } = await import('./usage')
    expect(withinHeadroom(['a', 'b', 'c'], null)).toEqual({ allowed: ['a', 'b', 'c'], skipped: 0 })
  })

  it('keeps only what fits and reports the rest as skipped, never dropping them silently', async () => {
    const { withinHeadroom } = await import('./usage')
    expect(withinHeadroom(['a', 'b', 'c'], 1)).toEqual({ allowed: ['a'], skipped: 2 })
    expect(withinHeadroom(['a', 'b', 'c'], 0)).toEqual({ allowed: [], skipped: 3 })
  })

  it('never over-takes when headroom exceeds the batch', async () => {
    const { withinHeadroom } = await import('./usage')
    expect(withinHeadroom(['a'], 9)).toEqual({ allowed: ['a'], skipped: 0 })
  })
})

describe('resourceHeadroom (io)', () => {
  it('free plan (1 connection) with none used → exactly one more', async () => {
    const { resourceHeadroom } = await import('./usage')
    expect(await resourceHeadroom('org1', 'database_connections', SOURCES)).toEqual({
      limit: 1,
      used: 0,
      remaining: 1,
    })
  })

  it('free plan with the cap already used → no headroom, so a 10-project batch is refused', async () => {
    state.count = 1
    const { resourceHeadroom } = await import('./usage')
    const room = await resourceHeadroom('org1', 'database_connections', SOURCES)
    expect(room.remaining).toBe(0)
    // this is the picker's guard: refs.length > remaining
    expect(3 > (room.remaining ?? Infinity)).toBe(true)
  })

  it('premium is uncapped (limit -1 → null), so no batch is ever refused', async () => {
    state.plan = 'premium'
    state.count = 42
    const { resourceHeadroom } = await import('./usage')
    expect(await resourceHeadroom('org1', 'database_connections', SOURCES)).toMatchObject({
      limit: null,
      remaining: null,
    })
  })

  it('fails OPEN when billing is not configured — capping a user who cannot pay strands them', async () => {
    delete process.env.PADDLE_API_KEY
    state.count = 99
    const { resourceHeadroom } = await import('./usage')
    expect(await resourceHeadroom('org1', 'database_connections', SOURCES)).toMatchObject({
      limit: null,
      remaining: null,
    })
  })
})

describe('enforceResourceLimit still answers "one more?" over the same primitive', () => {
  it('allows while there is headroom', async () => {
    const { enforceResourceLimit } = await import('./usage')
    expect((await enforceResourceLimit('org1', 'database_connections', SOURCES)).ok).toBe(true)
  })

  it('blocks with a localized message naming the cap', async () => {
    state.count = 1
    const { enforceResourceLimit } = await import('./usage')
    const res = await enforceResourceLimit('org1', 'database_connections', SOURCES)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('1')
  })
})
