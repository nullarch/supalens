import { describe, expect, it } from 'vitest'

import { percentSanityIssue } from './percent-sanity'
import { ChartSpec } from './spec'

/** Parse a raw chart through the real schema (applies defaults) — mirrors what the tools validate. */
function chart(raw: Record<string, unknown>): ChartSpec {
  const r = ChartSpec.safeParse(raw)
  if (!r.success) throw new Error('invalid test chart: ' + JSON.stringify(r.error.flatten()))
  return r.data
}

describe('percentSanityIssue', () => {
  // the exact production regression: SQL did `round(100.0 * …)` → 1.27 means 1.27%,
  // but percent format ×100s it again → "127%"
  it('rejects a percent-formatted bignumber holding percentage points (the 127% bug)', () => {
    const c = chart({
      type: 'bignumber',
      title: '유료 전환율',
      value: 'paying_conversion_pct',
      format: { kind: 'percent', decimals: 2 },
    })
    const issue = percentSanityIssue(c, [{ paying_conversion_pct: '1.27' }])
    expect(issue).toMatch(/percent/i)
    expect(issue).toMatch(/paying_conversion_pct/)
    expect(issue).toMatch(/unit.*%/i) // self-repair path is spelled out
  })

  it('accepts a percent-formatted fraction (the intended convention)', () => {
    const c = chart({ type: 'bignumber', title: 'rate', value: 'r', format: { kind: 'percent' } })
    expect(percentSanityIssue(c, [{ r: 0.0127 }])).toBeNull()
    expect(percentSanityIssue(c, [{ r: 1 }])).toBeNull() // exactly 100% is legit
  })

  it('accepts percentage points when formatted as number + unit %', () => {
    const c = chart({ type: 'bignumber', title: 'rate', value: 'r', format: { kind: 'number', unit: '%' } })
    expect(percentSanityIssue(c, [{ r: 45.2 }])).toBeNull()
  })

  it('checks the kpi comparison column too', () => {
    const c = chart({
      type: 'kpi',
      title: '전환율',
      value: 'cur',
      comparison: { value: 'prev' },
      format: { kind: 'percent' },
    })
    expect(percentSanityIssue(c, [{ cur: 0.4, prev: 42 }])).toMatch(/prev/)
  })

  it('checks a cartesian series via yFormat (single and multi y)', () => {
    const single = chart({ type: 'line', title: 't', x: 'day', y: 'rate', yFormat: { kind: 'percent' } })
    expect(percentSanityIssue(single, [{ day: 'd1', rate: 0.3 }, { day: 'd2', rate: 45 }])).toMatch(/rate/)

    const multi = chart({ type: 'multiLine', title: 't', x: 'day', y: ['a', 'b'], yFormat: { kind: 'percent' } })
    expect(percentSanityIssue(multi, [{ day: 'd1', a: 0.3, b: 12.5 }])).toMatch(/\bb\b/)
    expect(percentSanityIssue(multi, [{ day: 'd1', a: 0.3, b: 0.9 }])).toBeNull()
  })

  it('checks table per-column formats', () => {
    const c = chart({
      type: 'table',
      title: 't',
      columns: [
        { key: 'name' },
        { key: 'share', format: { kind: 'percent' } },
      ],
    })
    expect(percentSanityIssue(c, [{ name: 'x', share: 33.3 }])).toMatch(/share/)
    expect(percentSanityIssue(c, [{ name: 'x', share: 0.333 }])).toBeNull()
  })

  it('checks pie/donut valueFormat', () => {
    const c = chart({ type: 'donut', title: 't', category: 'plan', value: 'share', valueFormat: { kind: 'percent' } })
    expect(percentSanityIssue(c, [{ plan: 'pro', share: 62 }])).toMatch(/share/)
  })

  it('ignores non-numeric / null values and non-percent formats', () => {
    const c = chart({ type: 'bignumber', title: 't', value: 'v', format: { kind: 'percent' } })
    expect(percentSanityIssue(c, [{ v: null }])).toBeNull()
    expect(percentSanityIssue(c, [{ v: 'n/a' }])).toBeNull()
    expect(percentSanityIssue(c, [])).toBeNull()

    const currency = chart({ type: 'bignumber', title: 't', value: 'v', format: { kind: 'currency', currency: 'KRW' } })
    expect(percentSanityIssue(currency, [{ v: 1500000 }])).toBeNull()
  })
})
