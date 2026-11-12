import { describe, expect, it } from 'vitest'

import { BASELINE_TIER, REPO_TIER } from './__fixtures__/supalens-md'
import { classifySection, codeRefs, extractEvidence, metricKey, parseSupalensMd, summarizeContext } from './parse'

describe('parseSupalensMd — repo tier', () => {
  const p = parseSupalensMd(REPO_TIER)

  it('reads the title and overview', () => {
    expect(p.title).toBe('dailycart — SUPALENS.md')
    expect(p.overview).toMatch(/grocery subscription/)
    expect(p.looksBaseline).toBe(false)
  })

  it('maps entities from pipe-table rows, bold bullets and colon bullets', () => {
    const byName = Object.fromEntries(p.entities.map((e) => [e.name, e]))
    expect(byName.Customer?.table).toBe('customers')
    expect(byName.Subscription?.table).toBe('subscriptions')
    expect(byName.Order?.table).toBe('orders')
    expect(byName.Refund?.table).toBe('refunds')
    expect(byName.Refund?.description).toMatch(/partial refunds/)
    expect(byName.Coupon?.table).toBe('coupons')
    // "### orders" under Key tables describes the SAME table the concept map already claims,
    // so it folds into the Order row instead of rendering a second "orders → orders" line.
    expect(p.entities.filter((e) => e.table === 'orders')).toHaveLength(1)
    expect(byName.Order?.description).toMatch(/one row per delivery attempt/)
    expect(byName.Order?.description).toMatch(/3 columns/)
    expect(p.entities.some((e) => e.name === 'orders')).toBe(false)
  })

  it('flattens nested enum bullets into one rule with evidence chips', () => {
    const status = p.rules.find((r) => r.section === 'enums' && r.text.startsWith('`orders.status`'))
    expect(status).toBeDefined()
    expect(status!.text).toMatch(/`paid` → payment confirmed/)
    expect(status!.text).toMatch(/`cancelled`, `refunded` → excluded/)
    expect(status!.evidence).toContain('src/lib/reports/revenue.ts:52-58')
    expect(status!.evidence).toContain('orders.status')
  })

  it('marks unconfirmed claims', () => {
    const r = p.rules.find((r) => /kakao/.test(r.text))
    expect(r?.confidence).toBe('unconfirmed')
  })

  it('collects relationships, filters and conventions as rules; gotchas separately', () => {
    expect(p.rules.filter((r) => r.section === 'relationships').length).toBe(3)
    const filters = p.rules.filter((r) => r.section === 'filters')
    expect(filters.some((r) => /dailycart\.dev/.test(r.text))).toBe(true)
    expect(filters.find((r) => /dailycart\.dev/.test(r.text))?.evidence).toContain('src/lib/reports/filters.ts:9')
    expect(p.gotchas).toHaveLength(2)
    expect(p.gotchas[0]).toMatch(/includes VAT/)
  })

  it('parses suggested KPIs with their SQL fences', () => {
    expect(p.metrics.map((m) => m.name)).toEqual(['MRR', 'Refund rate'])
    expect(p.metrics[0].definition).toMatch(/non-trial/)
    expect(p.metrics[0].sql).toMatch(/^select sum\(price\)/)
    expect(p.metrics[1].sql).toMatch(/refunded/)
  })

  it('summarizes counts', () => {
    const s = summarizeContext(p)
    expect(s.entities).toBeGreaterThanOrEqual(6)
    expect(s.rules).toBeGreaterThanOrEqual(8)
    expect(s.metrics).toBe(2)
    expect(s.gotchas).toBe(2)
  })
})

describe('parseSupalensMd — baseline tier', () => {
  const p = parseSupalensMd(BASELINE_TIER)

  it('is recognised as a schema-only digest', () => {
    expect(p.looksBaseline).toBe(true)
    expect(p.title).toMatch(/auto-generated baseline/)
  })

  it('turns each table subsection into an entity named after the table', () => {
    expect(p.entities.map((e) => e.table)).toEqual(['customers', 'orders', 'products', 'analytics.daily_sales'])
    expect(p.entities[1].description).toMatch(/6 columns/)
    expect(p.entities[1].description).toMatch(/customer_id/)
  })

  it('keeps detected conventions as rules and has no code-derived enums or metrics', () => {
    expect(p.rules.filter((r) => r.section === 'conventions')).toHaveLength(2)
    expect(p.rules.filter((r) => r.section === 'enums')).toHaveLength(0)
    expect(p.metrics).toHaveLength(0)
    expect(p.gotchas).toHaveLength(0)
  })
})

describe('parser robustness', () => {
  it('never throws on empty or headingless input', () => {
    expect(parseSupalensMd('')).toMatchObject({ entities: [], rules: [], metrics: [], gotchas: [], raw: '' })
    const p = parseSupalensMd('just a paragraph\nand another')
    expect(p.overview).toBe('just a paragraph and another')
    expect(p.entities).toEqual([])
  })

  it('classifies section titles across the generator variants', () => {
    expect(classifySection('Entity ↔ table/collection map')).toBe('entities')
    expect(classifySection('Enum / status / coded values')).toBe('enums')
    expect(classifySection('Relationships & join patterns')).toBe('relationships')
    expect(classifySection('Common query patterns & important filters')).toBe('filters')
    expect(classifySection('Gotchas')).toBe('gotchas')
    expect(classifySection('Detected conventions')).toBe('conventions')
    expect(classifySection('Suggested KPIs')).toBe('metrics')
    expect(classifySection('Tables')).toBe('tables')
    expect(classifySection('Overview')).toBe('overview')
    expect(classifySection('Deployment notes')).toBe('other')
  })

  it('extracts file refs and identifiers, capped and deduped', () => {
    const ev = extractEvidence('see `orders.status` and src/app/x.ts:12 and `orders.status` again (`status = 1`)')
    expect(ev).toEqual(['src/app/x.ts:12', 'orders.status', 'status = 1'])
  })
})

describe('metricKey', () => {
  it('collapses catalog slugs and doc headings onto the same key', () => {
    expect(metricKey('Refund rate')).toBe(metricKey('refund_rate'))
    expect(metricKey('MRR')).toBe(metricKey('mrr'))
    expect(metricKey('결제 전환율')).toBe(metricKey('결제전환율'))
  })

  it('keeps genuinely different metrics apart and tolerates empty input', () => {
    expect(metricKey('Refund rate')).not.toBe(metricKey('Refund count'))
    expect(metricKey('')).toBe('')
  })
})

describe('codeRefs', () => {
  it('keeps file references and drops identifiers that already read inline', () => {
    expect(codeRefs(['src/lib/reports/revenue.ts:52-58', 'orders.status', 'paid'])).toEqual([
      'src/lib/reports/revenue.ts:52-58',
    ])
    expect(codeRefs(['prisma/schema.prisma:88', 'subscriptions.status'])).toEqual(['prisma/schema.prisma:88'])
  })

  it('returns nothing when a rule has no code grounding', () => {
    expect(codeRefs(['deleted_at', 'deleted_at is null'])).toEqual([])
    expect(codeRefs(undefined)).toEqual([])
  })
})
