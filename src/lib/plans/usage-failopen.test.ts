import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Billing invariant: checkUsageQuota FAILS OPEN when billing infrastructure is
 * absent — no admin client (Supabase env unset) or no PADDLE_API_KEY — so a
 * deploy-before-migration / unconfigured environment never hard-blocks runs.
 */

beforeEach(() => {
  vi.resetModules()
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.PADDLE_API_KEY
})

describe('checkUsageQuota fail-open', () => {
  it('allows when the admin client is unconfigured', async () => {
    const { checkUsageQuota } = await import('./usage')
    const res = await checkUsageQuota('00000000-0000-0000-0000-000000000000')
    expect(res.allowed).toBe(true)
    expect(res.queries.limit).toBe(-1)
  })

  it('enforceResourceLimit / enforceSeatLimit are no-ops without Paddle', async () => {
    const { enforceResourceLimit, enforceSeatLimit } = await import('./usage')
    const r1 = await enforceResourceLimit('org', 'alerts_per_org', {
      table: 'alerts',
      label: 'alert',
      filters: [{ column: 'org_id', value: 'org' }],
    })
    expect(r1.ok).toBe(true)
    const r2 = await enforceSeatLimit('org')
    expect(r2.ok).toBe(true)
  })
})
