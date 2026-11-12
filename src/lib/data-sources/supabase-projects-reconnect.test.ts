import { describe, expect, it, vi } from 'vitest'

import { ReconnectRequiredError } from '@/lib/supabase-oauth/tokens'

/**
 * `listConnectionProjects` must turn a dead OAuth grant into a STATE, not an exception: the
 * setup project picker renders a reconnect CTA from it, and the route answers 200 instead of
 * leaking `String(e)` (which names an internal connection id) to the browser.
 */

const getCachedAccessToken = vi.fn()
vi.mock('@/lib/supabase-oauth/tokens', async (orig) => {
  const actual = await orig<typeof import('@/lib/supabase-oauth/tokens')>()
  return { ...actual, getCachedAccessToken: (...a: unknown[]) => getCachedAccessToken(...(a as [])) }
})

const listProjects = vi.fn()
vi.mock('@/lib/supabase-management/client', () => ({
  SupabaseManagementClient: class {
    listProjects = (...a: unknown[]) => listProjects(...(a as []))
  },
}))

/** Minimal chainable stub: every table read resolves to `{ data }`. */
function table(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
    chain[m] = () => chain
  }
  chain.then = (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: rows })
  return chain
}

vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: (t: string) => (t === 'provider_connections' ? table([{ id: 'conn-1' }]) : table([])),
  }),
}))

const { listConnectionProjects } = await import('./supabase-projects')

describe('listConnectionProjects — dead grant', () => {
  it('returns needsReconnect instead of throwing', async () => {
    getCachedAccessToken.mockRejectedValueOnce(new ReconnectRequiredError('conn-1', 'revoked'))

    const result = await listConnectionProjects('org-1')

    expect(result).toEqual({ connectionId: 'conn-1', projects: [], needsReconnect: true })
  })

  it('still throws faults that are NOT a dead grant', async () => {
    // A 5xx from the Management API is a transient upstream fault: swallowing it would show the
    // user a reconnect prompt for a problem reconnecting cannot fix.
    getCachedAccessToken.mockRejectedValueOnce(new Error('management api 503'))

    await expect(listConnectionProjects('org-1')).rejects.toThrow('management api 503')
  })

  it('reports a healthy connection as not needing reconnect', async () => {
    getCachedAccessToken.mockResolvedValueOnce('tok')
    listProjects.mockResolvedValueOnce([])

    const result = await listConnectionProjects('org-1')

    expect(result?.needsReconnect).toBe(false)
    expect(result?.connectionId).toBe('conn-1')
  })
})
