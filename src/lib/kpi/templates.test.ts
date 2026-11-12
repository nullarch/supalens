import { describe, expect, it } from 'vitest'

import { KPI_CATEGORIES, KpiAlertConfig } from '@/lib/kpi/types'
import { ChartSpec } from '@/lib/viz/spec'
import { KPI_TEMPLATES, renderTemplatesForPrompt } from './templates'
import { buildKpiExtractPrompt } from './prompt'

// Valid chart discriminators, derived from the single source of truth (spec.ts) so this test
// tracks any change to the ChartSpec union rather than a hand-copied list.
const CHART_TYPES = new Set(ChartSpec.options.map((o) => o.shape.type.value))

describe('KPI_TEMPLATES', () => {
  it('has unique, snake_case keys', () => {
    const keys = KPI_TEMPLATES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      expect(key).toMatch(/^[a-z][a-z0-9_]+$/)
    }
  })

  it('uses only valid categories and totals 22 (4+8+4+5+1)', () => {
    for (const t of KPI_TEMPLATES) {
      expect(KPI_CATEGORIES).toContain(t.category)
    }
    expect(KPI_TEMPLATES).toHaveLength(22)
    const count = (c: string) => KPI_TEMPLATES.filter((t) => t.category === c).length
    expect(count('growth')).toBe(4)
    expect(count('revenue')).toBe(8)
    expect(count('engagement')).toBe(4)
    expect(count('ops')).toBe(5)
    expect(count('funnel')).toBe(1)
    expect(count('custom')).toBe(0) // custom is prompt-instructed, never a template
  })

  it('has a valid ChartSpec discriminator for every defaultChartType', () => {
    for (const t of KPI_TEMPLATES) {
      expect(CHART_TYPES.has(t.defaultChartType)).toBe(true)
    }
  })

  it('has importance within 1-5 for every template', () => {
    for (const t of KPI_TEMPLATES) {
      expect(t.defaultImportance).toBeGreaterThanOrEqual(1)
      expect(t.defaultImportance).toBeLessThanOrEqual(5)
    }
  })

  it('has a schema-valid defaultAlert wherever one is present', () => {
    for (const t of KPI_TEMPLATES) {
      if (t.defaultAlert) {
        expect(KpiAlertConfig.safeParse(t.defaultAlert).success).toBe(true)
      }
    }
  })
})

describe('renderTemplatesForPrompt', () => {
  const rendered = renderTemplatesForPrompt()

  it('stays under the prompt-size budget', () => {
    expect(rendered.length).toBeLessThan(4000)
  })

  it('mentions every template key', () => {
    for (const t of KPI_TEMPLATES) {
      expect(rendered).toContain(t.key)
    }
  })

  it('renders the Korean title (no English-title leakage) for a spot-checked row', () => {
    expect(rendered).toContain('일 매출')
  })

  it('restricts the menu to the selected categories', () => {
    const revenueOnly = renderTemplatesForPrompt(['revenue'])
    expect(revenueOnly).toContain('daily_revenue') // a revenue template
    expect(revenueOnly).toContain('mrr')
    expect(revenueOnly).not.toContain('new_signups') // a growth template — excluded
    expect(revenueOnly).not.toContain('Growth:') // the growth header is dropped
  })

  it('yields an empty menu for a category with no templates (custom)', () => {
    expect(renderTemplatesForPrompt(['custom'])).toBe('')
  })

  it('treats an empty category list as "all"', () => {
    expect(renderTemplatesForPrompt([])).toBe(renderTemplatesForPrompt())
  })
})

describe('buildKpiExtractPrompt', () => {
  const t1 = buildKpiExtractPrompt({ tier: 1 })
  const t2 = buildKpiExtractPrompt({ tier: 2 })

  it('tier-1 does not mention code tools or track()', () => {
    expect(t1).not.toContain('track(')
    expect(t1).not.toContain('read_file')
    expect(t1).not.toContain('grep_code')
  })

  it('tier-2 does mention code tools and track()', () => {
    expect(t2).toContain('track(')
    expect(t2).toContain('read_file')
    expect(t2).toContain('grep_code')
  })

  it('both tiers carry the core tool + rule invariants', () => {
    for (const p of [t1, t2]) {
      expect(p).toContain('propose_kpi')
      expect(p).toContain('execute_sql')
      expect(p).toContain('get_schema')
      expect(p).toContain('KOREAN') // the Korean-title rule
    }
  })

  it('an unscoped run carries no SCOPE directive', () => {
    expect(t1).not.toContain('SCOPE —')
    expect(t2).not.toContain('SCOPE —')
  })

  it('a scoped run names the categories and drops out-of-scope templates', () => {
    const scoped = buildKpiExtractPrompt({ tier: 2, categories: ['revenue'] })
    expect(scoped).toContain('SCOPE —')
    expect(scoped).toContain('Revenue')
    expect(scoped).toContain('daily_revenue')
    expect(scoped).not.toContain('new_signups') // growth template excluded
  })

  it('suppresses the code-derived (funnel/custom) block when neither is scoped', () => {
    const scoped = buildKpiExtractPrompt({ tier: 2, categories: ['revenue'] })
    expect(scoped).not.toContain('Beyond the templates') // the code-derived block is gone
  })

  it('keeps the code-derived block when funnel or custom is scoped', () => {
    const withFunnel = buildKpiExtractPrompt({ tier: 2, categories: ['funnel'] })
    expect(withFunnel).toContain('Beyond the templates')
    const withCustom = buildKpiExtractPrompt({ tier: 2, categories: ['custom'] })
    expect(withCustom).toContain('Beyond the templates')
  })
})
