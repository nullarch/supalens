import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { validateKpiProposal, type ProposeKpiArgs, type StashedQuery } from './propose'
import { ProposeKpiInput } from './types'

const schema = z.object(ProposeKpiInput)

/** Parse a raw input into typed ProposeKpiArgs (applies chart defaults); throws if invalid. */
function parse(raw: Record<string, unknown>): ProposeKpiArgs {
  const r = schema.safeParse(raw)
  if (!r.success) throw new Error('invalid test input: ' + JSON.stringify(r.error.flatten()))
  return r.data
}

/** A minimal valid raw input; override fields per case. */
function rawInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    queryId: 'q1',
    key: 'daily_revenue',
    title: '일 매출',
    category: 'revenue',
    description: 'transaction.completed 웹훅 기준 일 매출 합계',
    importance: 4,
    chart: { type: 'bar', title: '일 매출', x: 'day', y: 'revenue' },
    evidence: [{ kind: 'table', ref: 'orders' }],
    // Every proposal must declare a monitor or say why it has none. Cases that pass an
    // `alert` must NOT also carry a reason (propose rejects both), so the default only
    // applies when the override didn't supply one.
    ...('alert' in over ? {} : { noMonitorReason: 'low_signal' }),
    ...over,
  }
}

/** A store holding one 2-column × 2-row (non-scalar) daily-revenue result under q1. */
function barStore(): Map<string, StashedQuery> {
  return new Map<string, StashedQuery>([
    [
      'q1',
      {
        sql: 'select day, revenue from daily_revenue order by day',
        columns: ['day', 'revenue'],
        rows: [
          { day: '2026-07-01', revenue: 100 },
          { day: '2026-07-02', revenue: 120 },
        ],
      },
    ],
  ])
}

/** A store holding one scalar (1×1) result under q1. */
function scalarStore(value: unknown): Map<string, StashedQuery> {
  return new Map<string, StashedQuery>([
    ['q1', { sql: 'select count(*) as failures from webhook_events where error is not null', columns: ['failures'], rows: [{ failures: value }] }],
  ])
}

describe('validateKpiProposal', () => {
  it('rejects an unknown queryId and points at execute_sql', () => {
    const res = validateKpiProposal(barStore(), new Set(), parse(rawInput({ queryId: 'nope' })))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/execute_sql/)
  })

  it('rejects a key already proposed this run', () => {
    const res = validateKpiProposal(barStore(), new Set(['daily_revenue']), parse(rawInput()))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/already proposed/i)
  })

  it('rejects a THRESHOLD alert when the result is not a single numeric scalar', () => {
    const alert = { type: 'threshold', operator: 'lt', threshold: 0 }

    // 2 columns → not scalar
    const twoCol = validateKpiProposal(barStore(), new Set(), parse(rawInput({ alert })))
    expect(twoCol.ok).toBe(false)
    if (!twoCol.ok) expect(twoCol.error).toMatch(/scalar/i)

    // 3 rows (single column) → not scalar
    const threeRowStore = new Map<string, StashedQuery>([
      ['q1', { sql: 'select v from t', columns: ['v'], rows: [{ v: 1 }, { v: 2 }, { v: 3 }] }],
    ])
    const threeRow = validateKpiProposal(
      threeRowStore,
      new Set(),
      parse(rawInput({ chart: { type: 'bignumber', title: 'v', value: 'v' }, alert })),
    )
    expect(threeRow.ok).toBe(false)
    if (!threeRow.ok) expect(threeRow.error).toMatch(/scalar/i)

    // 1×1 but non-numeric value → not scalar
    const nonNumeric = validateKpiProposal(
      scalarStore('abc'),
      new Set(),
      parse(rawInput({ chart: { type: 'bignumber', title: 'x', value: 'failures' }, alert })),
    )
    expect(nonNumeric.ok).toBe(false)
    if (!nonNumeric.ok) expect(nonNumeric.error).toMatch(/scalar/i)
  })

  it('ANOMALY alert requires a numeric SERIES, not a scalar (regression: dead scalar anomaly)', () => {
    const anomaly = { type: 'anomaly', sensitivity: 3 }

    // a real date-bucketed series (2+ numeric rows, measure last) → accepted
    const series = validateKpiProposal(
      barStore(), // {day, revenue} × 2 rows — last col numeric
      new Set(),
      parse(rawInput({ chart: { type: 'line', title: '일 매출 추이', x: 'day', y: 'revenue' }, alert: anomaly })),
    )
    expect(series.ok).toBe(true)
    if (series.ok) expect(series.proposal.alertConfig).toEqual(anomaly)

    // a scalar (1 row) can never fire an anomaly → rejected, pointing at the series requirement
    const scalar = validateKpiProposal(
      scalarStore(42),
      new Set(),
      parse(rawInput({ chart: { type: 'bignumber', title: 'x', value: 'failures' }, alert: anomaly })),
    )
    expect(scalar.ok).toBe(false)
    if (!scalar.ok) expect(scalar.error).toMatch(/series/i)
  })

  it('rejects a KPI that declares NO monitor and no reason (Monitor all must be honest)', () => {
    const res = validateKpiProposal(
      barStore(),
      new Set(),
      parse({ ...rawInput(), noMonitorReason: undefined }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/noMonitorReason/)
      // the error must list the allowed reasons so the model can self-repair
      expect(res.error).toMatch(/not_time_series/)
    }
  })

  it('rejects a KPI that declares BOTH an alert and a no-monitor reason', () => {
    const res = validateKpiProposal(
      scalarStore(3),
      new Set(),
      parse(
        rawInput({
          chart: { type: 'bignumber', title: 'x', value: 'failures' },
          alert: { type: 'threshold', operator: 'gt', threshold: 0 },
          noMonitorReason: 'low_signal',
        }),
      ),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/exactly one/i)
  })

  it('carries the no-monitor reason and note onto the proposal', () => {
    const res = validateKpiProposal(
      barStore(),
      new Set(),
      parse(rawInput({ noMonitorReason: 'categorical', noMonitorNote: '카테고리 분해라 단일 측정값이 없습니다.' })),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.proposal.alertConfig).toBeUndefined()
      expect(res.proposal.noMonitor).toEqual({
        kind: 'none',
        reason: 'categorical',
        note: '카테고리 분해라 단일 측정값이 없습니다.',
      })
    }
  })

  it('accepts the same non-scalar result when no alert is attached', () => {
    const res = validateKpiProposal(barStore(), new Set(), parse(rawInput()))
    expect(res.ok).toBe(true)
  })

  it('accepts an alert on a single numeric scalar and retains the alert config', () => {
    const alert = { type: 'threshold' as const, operator: 'gt' as const, threshold: 0 }
    const res = validateKpiProposal(
      scalarStore(3),
      new Set(),
      parse(rawInput({ key: 'webhook_failures', chart: { type: 'bignumber', title: '웹훅 실패', value: 'failures' }, alert })),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.proposal.alertConfig).toEqual(alert)
      expect(res.proposal.metricSql).toContain('webhook_events')
    }
  })

  it('coerces a numeric-string scalar (Number(v)) and accepts the alert', () => {
    const res = validateKpiProposal(
      scalarStore('1500000'),
      new Set(),
      parse(rawInput({ key: 'daily_gmv', chart: { type: 'bignumber', title: 'GMV', value: 'failures' }, alert: { type: 'threshold', operator: 'lt', threshold: 100 } })),
    )
    expect(res.ok).toBe(true)
  })

  it('rejects a chart that references a missing column and lists the valid columns', () => {
    const res = validateKpiProposal(
      barStore(),
      new Set(),
      parse(rawInput({ chart: { type: 'bar', title: 'x', x: 'day', y: 'amount' } })),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/amount/) // the missing column
      expect(res.error).toMatch(/day/) // valid columns are listed
      expect(res.error).toMatch(/revenue/)
    }
  })

  it('accepts a happy-path bar chart: binds the stashed SQL, caps the sample at 50 rows, carries evidence', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ day: `2026-07-${i + 1}`, revenue: i }))
    const sql = 'select day, revenue from daily order by day'
    const store = new Map<string, StashedQuery>([['q1', { sql, columns: ['day', 'revenue'], rows }]])
    const evidence = [
      { kind: 'file' as const, ref: 'src/webhooks/paddle.ts', note: 'transaction.completed' },
      { kind: 'table' as const, ref: 'orders' },
    ]

    const res = validateKpiProposal(store, new Set(), parse(rawInput({ evidence })))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.proposal.metricSql).toBe(sql)
      expect(res.proposal.vizSpec.query.sql).toBe(sql)
      expect(res.proposal.vizSpec.sample?.rows).toHaveLength(50) // 60 stashed → capped at 50
      expect(res.proposal.vizSpec.chart.type).toBe('bar')
      expect(res.proposal.evidence).toEqual(evidence)
      expect(res.proposal.category).toBe('revenue')
      expect(res.proposal.importance).toBe(4)
    }
  })

  it('rejects a percent-formatted chart whose values are percentage points (the 127% double-scale bug)', () => {
    const store = new Map<string, StashedQuery>([
      ['q1', { sql: 'select round(100.0 * 2 / 157, 2) as pct', columns: ['pct'], rows: [{ pct: '1.27' }] }],
    ])
    const res = validateKpiProposal(
      store,
      new Set(),
      parse(rawInput({ chart: { type: 'bignumber', title: '유료 전환율', value: 'pct', format: { kind: 'percent', decimals: 2 } } })),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/unit.*%/i) // repair path offered

    // the same values with the number+unit convention are accepted
    const ok = validateKpiProposal(
      store,
      new Set(),
      parse(rawInput({ chart: { type: 'bignumber', title: '유료 전환율', value: 'pct', format: { kind: 'number', decimals: 2, unit: '%' } } })),
    )
    expect(ok.ok).toBe(true)
  })

  it('does not mutate seenKeys (the caller records the key only after the sink accepts)', () => {
    const seen = new Set<string>()
    const res = validateKpiProposal(barStore(), seen, parse(rawInput()))
    expect(res.ok).toBe(true)
    expect(seen.size).toBe(0)
  })
})

describe('ProposeKpiInput zod shape', () => {
  it('rejects a non-snake_case key (uppercase or leading digit)', () => {
    expect(schema.safeParse(rawInput({ key: 'DailyRevenue' })).success).toBe(false)
    expect(schema.safeParse(rawInput({ key: '1daily' })).success).toBe(false)
    expect(schema.safeParse(rawInput({ key: 'daily_revenue' })).success).toBe(true)
  })

  it('rejects importance outside 1..5', () => {
    expect(schema.safeParse(rawInput({ importance: 0 })).success).toBe(false)
    expect(schema.safeParse(rawInput({ importance: 6 })).success).toBe(false)
    expect(schema.safeParse(rawInput({ importance: 3 })).success).toBe(true)
  })

  it('rejects empty evidence', () => {
    expect(schema.safeParse(rawInput({ evidence: [] })).success).toBe(false)
  })
})
