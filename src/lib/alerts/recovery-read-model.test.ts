import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }))
import { listAlerts } from './server'

describe('client-safe recovery connection mapping', () => {
  const source = { name: 'Sample source', org_id: 'org-a', provider: 'supabase', connection_id: 'connection-a', deleted_at: null }
  const connection = { id: 'connection-a', org_id: 'org-a', provider: 'supabase', status: 'active', token_refreshed_at: '2026-09-08T08:00:00Z', deleted_at: null }
  it.each([[connection, 'active'], [{ ...connection, org_id: 'other' }, null], [{ ...connection, id: 'other' }, null], [{ ...connection, deleted_at: '2026-09-08' }, null], [null, null]])('exposes progress only for the matching RLS-visible connection', async (parent, expected) => {
    const db = { from(table: string) {
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'is', 'limit', 'order']) query[method] = () => query
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'alerts' ? [{ id: 'monitor-a', org_id: 'org-a', data_sources: { ...source, provider_connections: parent } }] : [], error: null }).then(resolve)
      return query
    } }
    const [result] = await listAlerts(db as unknown as Parameters<typeof listAlerts>[0], 'org-a')
    expect(result.connectionStatus).toBe(expected)
    expect(result.connectionRefreshedAt).toBe(expected ? connection.token_refreshed_at : null)
  })
  it.each([
    [source, 'connection-a'], [{ ...source, org_id: 'other-org' }, null], [{ ...source, provider: 'self_hosted' }, null], [{ ...source, deleted_at: '2026-09-08' }, null], [null, null], [{ name: 'Partial source' }, null],
  ])('exposes only verified same-tenant Supabase connection IDs', async (dataSources, expected) => {
    const calls: unknown[][] = []
    const db = { from(table: string) {
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'is', 'limit', 'order']) builder[method] = (...args: unknown[]) => { calls.push([table, method, ...args]); return builder }
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'alerts' ? [{ id: 'monitor-a', org_id: 'org-a', data_sources: dataSources }] : [], error: null }).then(resolve)
      return builder
    } }
    const [result] = await listAlerts(db as unknown as Parameters<typeof listAlerts>[0], 'org-a')
    expect(result.connectionId).toBe(expected)
    const selection = calls.find(call => call[0] === 'alerts' && call[1] === 'select')?.[2] as string
    expect(selection).toContain('connection_id')
    expect(selection).not.toMatch(/config|secret|access_token|refresh_token|ciphertext/)
    expect(result).not.toHaveProperty('data_sources')
  })
})
