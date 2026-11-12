import { describe, expect, it, vi } from 'vitest'
import { common, localClient, oneElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

describe('actual context pages preserve parsed evidence and source identity', () => {
  it('index passes the existing source/context/hash conversion result unchanged', async () => {
    const { client } = localClient(), sources = [{ id: 'source-a' }, { id: 'source-b' }]
    const contexts = new Map(), hashes = new Map(), rows = [{ id: 'source-a', state: 'stale' }]
    const readContexts = vi.fn(async () => contexts), readHashes = vi.fn(async () => hashes), convert = vi.fn(() => rows)
    const page = loadRoute('app/business-model/page.tsx', {
      ...common, '@/utils/supabase/server': { createClient: async () => client },
      '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' },
      '@/components/dashboard/PageHead': { PageHead: 'PageHead' }, './BusinessModelIndex': { BusinessModelIndex: 'BusinessModelIndex' },
      './data': { loadSources: async () => sources, loadContexts: readContexts, loadSchemaHashes: readHashes, toRows: convert },
    })
    expect(oneElement(await page.default(), 'BusinessModelIndex').props.rows).toBe(rows)
    expect(readContexts).toHaveBeenCalledExactlyOnceWith(client, ['source-a', 'source-b'])
    expect(readHashes).toHaveBeenCalledExactlyOnceWith(client, ['source-a', 'source-b'])
    expect(convert).toHaveBeenCalledExactlyOnceWith(sources, contexts, hashes)
  })
  for (const engine of ['postgres', 'firestore']) for (const catalogFails of [false, true]) {
    it(`detail preserves document fields, raw time, source key and best-effort catalog (${engine}/${catalogFails})`, async () => {
      const { client, calls } = localClient({ data_sources: [{ id: 'source-a', name: 'Production', engine, repo_id: 'attached-repo' }], github_repositories: [{ full_name: 'sample/context-repo' }] })
      const ctx = { contentMd: 'Sample document', sourceRepoId: 'context-repo', generatedAt: '2026-09-08T00:00:00Z', generatedFromSha: 'sample-sha', schemaHash: 'old-hash', model: 'sample-model', error: null }
      const parsed = { title: 'Sample context', looksBaseline: false }, parse = vi.fn(() => parsed), resolveState = vi.fn(() => 'stale')
      const catalog = vi.fn(async () => {
        if (catalogFails) throw new Error('Local unavailable catalog')
        return [{ title: 'Revenue', key: 'revenue', status: 'accepted' }, { title: 'Revenue', key: 'revenue', status: 'proposed' }]
      })
      const page = loadRoute('app/business-model/[sourceId]/page.tsx', {
        ...common, 'next/link': 'Link', '@/utils/supabase/server': { createClient: async () => client },
        '@/components/dashboard/PageHead': { PageHead: 'PageHead' },
        '@/lib/context/parse': { parseSupalensMd: parse, metricKey: (value: string) => value.toLowerCase() },
        '@/lib/kpi/service': { listKpis: catalog }, '../Bits': { StateDot: 'StateDot', TierChip: 'TierChip' },
        '../data': { hasDoc: () => true, loadContexts: async () => new Map([['source-a', ctx]]), loadSchemaHashes: async () => new Map([['source-a', 'new-hash']]), resolveContextState: resolveState },
        './BusinessModelTabs': { BusinessModelTabs: 'BusinessModelTabs' }, '../business-model.module.css': {},
      })
      const tree = await page.default({ params: Promise.resolve({ sourceId: 'source-a' }) })
      const view = oneElement(tree, 'BusinessModelTabs')
      expect(view.key).toBe('source-a')
      expect(view.props).toEqual({ sourceId: 'source-a', parsed, state: 'stale',
        metricLinks: engine === 'postgres' && !catalogFails ? { revenue: { status: 'accepted', title: 'Revenue' } } : {},
        generatedAt: ctx.generatedAt, generatedFromSha: ctx.generatedFromSha, schemaHash: ctx.schemaHash, model: ctx.model, error: null, repoName: 'sample/context-repo',
      })
      expect(parse).toHaveBeenCalledExactlyOnceWith(ctx.contentMd)
      expect(resolveState).toHaveBeenCalledExactlyOnceWith(ctx, 'new-hash')
      expect(catalog).toHaveBeenCalledTimes(engine === 'postgres' ? 1 : 0)
      expect(calls).toContainEqual(['data_sources', 'eq', 'id', 'source-a'])
      expect(calls).toContainEqual(['data_sources', 'is', 'deleted_at', null])
      expect(calls).toContainEqual(['github_repositories', 'eq', 'id', 'context-repo'])
    })
  }
  it('missing source stops before document or catalog reads', async () => {
    const { client } = localClient(), forbidden = vi.fn(() => { throw new Error('Unexpected read') })
    const page = loadRoute('app/business-model/[sourceId]/page.tsx', {
      ...common, 'next/link': 'Link', '@/utils/supabase/server': { createClient: async () => client },
      '@/components/dashboard/PageHead': {}, '@/lib/context/parse': {}, '@/lib/kpi/service': { listKpis: forbidden },
      '../Bits': {}, '../data': { loadContexts: forbidden, loadSchemaHashes: forbidden }, './BusinessModelTabs': {}, '../business-model.module.css': {},
    })
    await expect(page.default({ params: Promise.resolve({ sourceId: 'missing' }) })).rejects.toThrow('NOT_FOUND')
    expect(forbidden).not.toHaveBeenCalled()
  })
})
