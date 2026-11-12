import { describe, expect, it } from 'vitest'

import { figuresFrom, inferChart, niceScale, pickTicks, stackExtent, toCartesian, toSlices, type Table } from './model'

/**
 * The decisions behind the MCP App result view. The view only paints; what it paints is decided
 * here, so these pin the two things a reader relies on: a bare query result is charted only when
 * its shape is unambiguous, and the numbers drawn are the numbers in the rows.
 */
const table = (columns: string[], rows: unknown[][]): Table => ({
  columns,
  rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))),
})

describe('inferChart', () => {
  it('one row with one number is the number', () => {
    expect(inferChart(table(['mrr'], [[48213.5]]), 'q')).toMatchObject({ type: 'bignumber', value: 'mrr' })
  })

  it('a date column with numeric columns is a line over time', () => {
    const one = inferChart(table(['day', 'signups'], [['2026-10-01', 4], ['2026-10-02', 7]]), 'q')
    expect(one).toMatchObject({ type: 'line', x: 'day', y: 'signups', xFormat: { kind: 'date', dateGranularity: 'day' } })
    const two = inferChart(table(['month', 'a', 'b'], [['2026-09', 1, 2], ['2026-10', 3, 4]]), 'q')
    expect(two).toMatchObject({ type: 'multiLine', y: ['a', 'b'], xFormat: { dateGranularity: 'month' } })
  })

  it('distinct categories with one measure are horizontal bars', () => {
    expect(inferChart(table(['plan', 'n'], [['free', 10], ['pro', 3]]), 'q')).toMatchObject({
      type: 'bar', x: 'plan', y: 'n', orientation: 'horizontal',
    })
  })

  it.each([
    ['a repeated category (the rows are not one-per-category)', table(['plan', 'n'], [['free', 1], ['free', 2]])],
    ['two measures beside a category', table(['plan', 'n', 'm'], [['free', 1, 2], ['pro', 3, 4]])],
    ['a single dated row', table(['day', 'n'], [['2026-10-01', 4]])],
    ['text only', table(['a', 'b'], [['x', 'y']])],
    ['more categories than a bar list can carry', table(['k', 'n'], Array.from({ length: 31 }, (_, i) => [`k${i}`, i]))],
    ['no rows', table(['day', 'n'], [])],
  ])('%s stays a table', (_label, data) => {
    expect(inferChart(data, 'q').type).toBe('table')
  })

  it('a year-like string is a label, not a quantity to plot as the measure', () => {
    // "2026-01" is a date; a bare id column of digits is numeric and must not become a time axis
    expect(inferChart(table(['id', 'n'], [[1, 5], [2, 6]]), 'q').type).toBe('table')
  })
})

describe('figuresFrom', () => {
  it('draws a bare result as one inferred figure', () => {
    const figures = figuresFrom({ dataSourceId: 'd', ...table(['mrr'], [[1]]) }, 'Query result')
    expect(figures).toHaveLength(1)
    expect(figures[0]).toMatchObject({ inferred: true, chart: { type: 'bignumber', title: 'Query result' } })
  })

  it("draws an analysis's own charts from their embedded samples, and skips one without rows", () => {
    const sample = table(['day', 'n'], [['2026-10-01', 1]])
    const chart = { type: 'line', title: 'Signups', x: 'day', y: 'n', curve: 'linear' }
    const figures = figuresFrom(
      { done: true, result: { visualizations: [{ v: 1, query: { sql: 's' }, chart, sample }, { v: 1, query: { sql: 's' }, chart }] } },
      'x',
    )
    expect(figures).toHaveLength(1)
    expect(figures[0].inferred).toBeUndefined()
    expect(figures[0].chart).toMatchObject({ title: 'Signups' })
  })

  it.each([null, 'text', 42, {}, { result: null }, { result: { visualizations: 'no' } }])('draws nothing for %j', (payload) => {
    expect(figuresFrom(payload, 'x')).toEqual([])
  })
})

describe('toCartesian', () => {
  const base = { title: 't', x: 'm', orientation: 'vertical' as const }

  it('reads the wide form: one series per y column', () => {
    const c = toCartesian({ ...base, type: 'groupedBar', y: ['a', 'b'] }, table(['m', 'a', 'b'], [['jan', 1, 2], ['feb', 3, null]]).rows)
    expect(c.categories).toEqual(['jan', 'feb'])
    expect(c.series).toEqual([{ name: 'a', values: [1, 3] }, { name: 'b', values: [2, null] }])
  })

  it('pivots the long form, keeps gaps as gaps, and adds repeated cells', () => {
    const rows = table(['m', 'plan', 'v'], [['jan', 'pro', 5], ['jan', 'free', 1], ['feb', 'pro', 7], ['feb', 'pro', 1]]).rows
    const c = toCartesian({ ...base, type: 'stackedBar', y: 'v', series: 'plan' }, rows)
    expect(c.series).toEqual([{ name: 'pro', values: [5, 8] }, { name: 'free', values: [1, null] }])
  })

  it('keeps the eight largest series in their original order and counts the rest', () => {
    const names = Array.from({ length: 11 }, (_, i) => `s${i}`)
    const rows = names.map((name, i) => ({ m: 'jan', plan: name, v: i === 0 ? 100 : i }))
    const c = toCartesian({ ...base, type: 'stackedBar', y: 'v', series: 'plan' }, rows)
    expect(c.series.map((s) => s.name)).toEqual(['s0', 's4', 's5', 's6', 's7', 's8', 's9', 's10'])
    expect(c.hiddenSeries).toBe(3)
  })
})

describe('scales', () => {
  it('anchors a length encoding at zero and lands on clean steps', () => {
    expect(niceScale(12, 141)).toEqual({ min: 0, max: 150, ticks: [0, 50, 100, 150] })
    expect(niceScale(-30, 55).ticks).toEqual([-50, 0, 50, 100])
  })
  it('lets a position encoding leave zero', () => {
    const s = niceScale(60, 102, { zero: false })
    expect(s.min).toBe(60)
    expect(s.max).toBeGreaterThanOrEqual(102)
  })
  it('survives a flat series', () => {
    expect(niceScale(0, 0).max).toBeGreaterThan(0)
    const flat = niceScale(5, 5, { zero: false })
    expect(flat.max).toBeGreaterThan(flat.min)
  })
  it('stacks negatives downward', () => {
    expect(stackExtent([{ name: 'a', values: [3, -2] }, { name: 'b', values: [4, -5] }])).toEqual({ min: -7, max: 7 })
  })
  it('spaces axis labels evenly so neighbours never sit side by side', () => {
    expect(pickTicks(5, 8)).toEqual([0, 1, 2, 3, 4])
    const ticks = pickTicks(14, 7)
    expect(ticks).toEqual([0, 2, 4, 6, 8, 10, 12])
    expect(pickTicks(30, 4).every((t, i, a) => i === 0 || t - a[i - 1] === 8)).toBe(true)
  })
})

describe('toSlices', () => {
  it('orders by size, folds the tail, and shares sum to one', () => {
    const rows = [['a', 50], ['b', 20], ['c', 10], ['d', 8], ['e', 6], ['f', 4], ['g', 2], ['neg', -5]].map(([k, v]) => ({ k, v }))
    const parts = toSlices(rows, 'k', 'v', 'Other')
    expect(parts.map((p) => p.label)).toEqual(['a', 'b', 'c', 'd', 'e', 'Other'])
    expect(parts[5].value).toBe(6)
    expect(parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1)
  })
})
