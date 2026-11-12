import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getBootstrapStatus` is polled every 5 SECONDS by the setup screen, so its per-tick cost is the
 * thing under test. Two defects it used to have:
 *   1. it selected every `kpi_catalog` row just to count them (a catalog can hold dozens),
 *   2. it pulled `content_md` — up to 24k chars — and re-ran `parseSupalensMd` over it on EVERY
 *      tick, even though the doc only changes when `data_source_context.updated_at` moves.
 * The response SHAPE must be byte-identical either way: the setup client consumes it directly.
 */

const parseSupalensMd = vi.fn(() => ({
  entities: [{ name: 'Order', table: 'orders' }],
  rules: [{ text: 'orders.status is an enum', section: 'enums' }],
}))
vi.mock('@/lib/context/parse', () => ({
  parseSupalensMd: (...a: unknown[]) => parseSupalensMd(...(a as [])),
  summarizeContext: () => ({ entities: 1, rules: 1, metrics: 0, gotchas: 0 }),
}))

vi.mock('@/lib/kpi/service', () => ({ latestExtraction: async () => null }))

const state = {
  objectCount: 12,
  ctx: null as null | { status: string; error: string | null; updated_at: string },
  contentMd: '# doc' as string | null,
  kpiTitles: [] as string[],
  kpiCount: 0,
}

/** Records every column list asked of `data_source_context`, so the test can see what was fetched. */
const contextSelects: string[] = []

vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: (table: string) => ({
      select: (cols: string, opts?: { count?: string; head?: boolean }) => {
        if (table === 'data_source_objects') {
          return { eq: async () => ({ count: state.objectCount, error: null }) }
        }
        if (table === 'data_source_context') {
          contextSelects.push(cols)
          const data = cols.includes('content_md')
            ? state.contentMd == null
              ? []
              : [{ content_md: state.contentMd }]
            : state.ctx
              ? [state.ctx]
              : []
          return { eq: () => ({ limit: async () => ({ data, error: null }) }) }
        }
        if (table === 'kpi_catalog') {
          const rows = state.kpiTitles.map((title) => ({ title }))
          const b = {
            eq: () => b,
            limit: async () => ({ data: rows, error: null, count: opts?.count ? state.kpiCount : null }),
          }
          return b
        }
        throw new Error(`unexpected table ${table}`)
      },
    }),
  }),
}))

import { getBootstrapStatus } from './status'

beforeEach(() => {
  parseSupalensMd.mockClear()
  contextSelects.length = 0
  state.objectCount = 12
  state.ctx = { status: 'fresh', error: null, updated_at: '2026-09-05T00:00:00Z' }
  state.contentMd = '# doc'
  state.kpiTitles = []
  state.kpiCount = 0
})

describe('getBootstrapStatus', () => {
  it('keeps the documented shape (phases / counts / items / resumeFrom)', async () => {
    state.kpiTitles = ['Revenue']
    state.kpiCount = 1
    const s = await getBootstrapStatus('ds1')
    expect(s.phases).toEqual({ schema: 'done', context: 'done', kpi: 'pending' })
    expect(s.counts).toEqual({ tables: 12, entities: 1, rules: 1, kpis: 1 })
    expect(s.items).toEqual({ entities: ['Order'], rules: ['orders.status is an enum'], kpis: ['Revenue'] })
    expect(s.active).toBe(false)
    expect(s.resumeFrom).toBe('kpi')
  })

  it('counts KPI proposals from the DB, not from the rows it fetched', async () => {
    // 12 rows are fetched for the name strip; the counter must still report the real total.
    state.kpiTitles = Array.from({ length: 12 }, (_, i) => `k${i}`)
    state.kpiCount = 47
    const s = await getBootstrapStatus('ds1')
    expect(s.counts.kpis).toBe(47)
    expect(s.items.kpis).toHaveLength(12)
  })

  it('parses SUPALENS.md ONCE per version — later polls neither fetch nor re-parse the doc', async () => {
    await getBootstrapStatus('ds-poll')
    expect(parseSupalensMd).toHaveBeenCalledTimes(1)
    expect(contextSelects.some((c) => c.includes('content_md'))).toBe(true)

    contextSelects.length = 0
    for (let i = 0; i < 5; i++) await getBootstrapStatus('ds-poll')
    expect(parseSupalensMd).toHaveBeenCalledTimes(1) // still once
    expect(contextSelects.every((c) => !c.includes('content_md'))).toBe(true) // and the body is not re-read
  })

  it('re-parses when the doc is regenerated (updated_at moves)', async () => {
    await getBootstrapStatus('ds-regen')
    state.ctx = { status: 'fresh', error: null, updated_at: '2026-09-06T00:00:00Z' }
    await getBootstrapStatus('ds-regen')
    expect(parseSupalensMd).toHaveBeenCalledTimes(2)
  })

  it('reports no entity/rule counts while the doc does not exist yet', async () => {
    state.ctx = { status: 'generating', error: null, updated_at: '2026-09-05T00:00:00Z' }
    state.contentMd = null
    const s = await getBootstrapStatus('ds-pending')
    expect(s.phases.context).toBe('running')
    expect(s.counts.entities).toBeNull() // null = "not measured yet", never a fake 0
    expect(s.active).toBe(true)
    expect(parseSupalensMd).not.toHaveBeenCalled()
  })
})
