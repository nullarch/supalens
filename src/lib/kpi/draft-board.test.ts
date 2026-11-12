import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: () => { throw new Error('not used by the pure helpers') } }))

import { DRAFT_WIDGET_LIMIT, draftCandidates } from './draft-board'
import type { KpiCatalogRow } from './types'

const row = (id: string, importance: number, over: Partial<KpiCatalogRow> = {}): KpiCatalogRow => ({
  id, orgId: 'org-a', dataSourceId: 'src-a', extractionId: 'x', key: id, title: id, category: 'revenue' as KpiCatalogRow['category'],
  description: null, importance, metricSql: 'select 1', vizSpec: { v: 1, query: { sql: 'select 1' }, chart: { type: 'kpi', title: id } } as unknown as KpiCatalogRow['vizSpec'],
  alertConfig: null, noMonitor: null, evidence: [], status: 'proposed', applied: null, createdAt: '', updatedAt: '', ...over,
})

describe('draftCandidates', () => {
  it('uses still-proposed KPIs only, most important first and stable within a tier', () => {
    const picked = draftCandidates([
      row('a', 3), row('b', 5), row('c', 5), row('d', 4),
      row('dismissed', 5, { status: 'dismissed' }), row('accepted', 5, { status: 'accepted' }), row('stale', 5, { status: 'stale' as KpiCatalogRow['status'] }),
    ])
    expect(picked.map(r => r.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('caps the draft so the home board stays readable', () => {
    const picked = draftCandidates(Array.from({ length: 10 }, (_, i) => row(`k${i}`, 5)))
    expect(picked).toHaveLength(DRAFT_WIDGET_LIMIT)
    expect(DRAFT_WIDGET_LIMIT).toBe(6)
  })

  it('skips proposals without a runnable query or chart', () => {
    const picked = draftCandidates([row('ok', 4), row('nosql', 5, { metricSql: '' }), row('nochart', 5, { vizSpec: {} as KpiCatalogRow['vizSpec'] })])
    expect(picked.map(r => r.id)).toEqual(['ok'])
  })
})
