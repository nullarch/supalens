import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { MAX_CHARTS_PER_RUN, validateVizProposal, type StoredQueryResult } from './propose'
import { ProposeVizInput } from './spec'

const schema = z.object(ProposeVizInput)

/** Parse a raw input into typed {queryId, chart} (applies chart defaults); throws if invalid. */
function parse(raw: Record<string, unknown>): z.infer<typeof schema> {
  const r = schema.safeParse(raw)
  if (!r.success) throw new Error('invalid test input: ' + JSON.stringify(r.error.flatten()))
  return r.data
}

/** A minimal valid bar proposal against q1; override fields per case. */
function barInput(over: Record<string, unknown> = {}): z.infer<typeof schema> {
  return parse({
    queryId: 'q1',
    chart: { type: 'bar', title: '일 매출', x: 'day', y: 'revenue' },
    ...over,
  })
}

/** A store holding one 2-column daily-revenue result under q1. */
function barStore(rows?: Record<string, unknown>[]): Map<string, StoredQueryResult> {
  return new Map<string, StoredQueryResult>([
    [
      'q1',
      {
        sql: 'select day, revenue from daily_revenue order by day',
        columns: ['day', 'revenue'],
        rows: rows ?? [
          { day: '2026-07-01', revenue: 100 },
          { day: '2026-07-02', revenue: 120 },
        ],
      },
    ],
  ])
}

describe('validateVizProposal', () => {
  it('accepts a valid chart and assembles the spec envelope', () => {
    const res = validateVizProposal(barStore(), 0, barInput())
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.spec.v).toBe(1)
      expect(res.spec.query.sql).toMatch(/daily_revenue/)
      expect(res.spec.query.queryId).toBe('q1')
      expect(res.spec.chart.type).toBe('bar')
      expect(res.spec.sample?.rows).toHaveLength(2)
    }
  })

  it('caps the embedded sample at 200 rows', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ day: `d${i}`, revenue: i }))
    const res = validateVizProposal(barStore(many), 0, barInput())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.spec.sample?.rows).toHaveLength(200)
  })

  it('pins the product policy: at most 3 charts per answer', () => {
    expect(MAX_CHARTS_PER_RUN).toBe(3)
  })

  it('accepts up to the chart limit and rejects the proposal past it', () => {
    // the last allowed slot is fine…
    const atLastSlot = validateVizProposal(barStore(), MAX_CHARTS_PER_RUN - 1, barInput())
    expect(atLastSlot.ok).toBe(true)

    // …but once MAX charts are accepted, even a perfectly valid proposal is rejected.
    const overBudget = validateVizProposal(barStore(), MAX_CHARTS_PER_RUN, barInput())
    expect(overBudget.ok).toBe(false)
    if (!overBudget.ok) expect(overBudget.error).toMatch(/chart limit reached/i)
  })

  it('rejects an unknown queryId and points at the query tool', () => {
    const res = validateVizProposal(barStore(), 0, barInput({ queryId: 'nope' }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/execute_sql/)

    // the Firestore tools override the hint
    const fs = validateVizProposal(barStore(), 0, barInput({ queryId: 'nope' }), {
      queryToolHint: 'query_documents or aggregate',
    })
    expect(fs.ok).toBe(false)
    if (!fs.ok) expect(fs.error).toMatch(/query_documents or aggregate/)
  })

  it('rejects a chart referencing columns missing from the result, listing valid ones', () => {
    const res = validateVizProposal(barStore(), 0, barInput({ chart: { type: 'bar', title: 't', x: 'day', y: 'amount' } }))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/"amount"/)
      expect(res.error).toMatch(/"revenue"/)
    }
  })

  it('rejects an envelope that fails spec validation (empty sql descriptor)', () => {
    const empty = new Map<string, StoredQueryResult>([['q1', { sql: '', columns: ['day', 'revenue'], rows: [] }]])
    const res = validateVizProposal(empty, 0, barInput())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/invalid visualization spec/i)
  })

  it('rejects percent-formatted columns holding percentage points (double-scale guard)', () => {
    const pct = new Map<string, StoredQueryResult>([
      ['q1', { sql: 'select day, rate from t', columns: ['day', 'rate'], rows: [{ day: 'd1', rate: 12.7 }] }],
    ])
    const res = validateVizProposal(
      pct,
      0,
      barInput({ chart: { type: 'bar', title: 't', x: 'day', y: 'rate', yFormat: { kind: 'percent' } } }),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/FRACTIONS/)
  })

  it('threads the Firestore re-run descriptor into the envelope', () => {
    const store = new Map<string, StoredQueryResult>([
      [
        'q1',
        {
          sql: 'firestore: orders',
          columns: ['day', 'revenue'],
          rows: [{ day: 'd1', revenue: 1 }],
          firestore: { collection: 'orders' },
        },
      ],
    ])
    const res = validateVizProposal(store, 0, barInput())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.spec.query.firestore?.collection).toBe('orders')
  })
})
