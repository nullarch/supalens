import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
import { loadIntegrationRows } from './settings-data'

const tables = ['provider_connections', 'data_sources', 'github_repositories']
type Result = { data: unknown; error: unknown }
function clientWith(results: Result[]) {
  const queries: Array<{ table: string; steps: unknown[][] }> = []
  const client = { from: (table: string) => {
    const query = { table, steps: [] as unknown[][] }; queries.push(query)
    const builder = {
      select: (...args: unknown[]) => { query.steps.push(['select', ...args]); return builder },
      eq: (...args: unknown[]) => { query.steps.push(['eq', ...args]); return builder },
      is: (...args: unknown[]) => { query.steps.push(['is', ...args]); return builder },
      order: async (...args: unknown[]) => { query.steps.push(['order', ...args]); return results[tables.indexOf(table)] },
    }; return builder
  } }
  return { client: client as unknown as SupabaseClient, queries }
}
describe('integration settings reads', () => {
  it('scopes all three reads to the selected workspace and preserves valid empty lists', async () => {
    const { client, queries } = clientWith(tables.map(() => ({ data: [], error: null })))
    await expect(loadIntegrationRows(client, 'selected-org')).resolves.toEqual({ conns: [], sources: [], repos: [] })
    expect(queries.map(q => q.table)).toEqual(tables)
    for (const query of queries) {
      expect(query.steps).toContainEqual(['eq', 'org_id', 'selected-org'])
      expect(query.steps).toContainEqual(['is', 'deleted_at', null])
    }
  })
  for (const index of [0, 1, 2]) for (const bad of [{ data: null, error: { message: 'private detail' } }, { data: null, error: null }, { data: {}, error: null }]) {
    it(`read ${index} unavailable is not an empty integration state`, async () => {
      const results = tables.map((): Result => ({ data: [], error: null })); results[index] = bad
      await expect(loadIntegrationRows(clientWith(results).client, 'selected-org')).rejects.toThrow('integration_settings_unavailable')
    })
  }
})
