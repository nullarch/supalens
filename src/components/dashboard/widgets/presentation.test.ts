import { describe, expect, it } from 'vitest'
import { ChartSpec } from '@/lib/viz/spec'
import { chartDataIssue, widgetTimestamp } from './presentation'
import { maxSeriesValue } from './charts/data'

describe('widget evidence presentation', () => {
  it('renders a fixed UTC record even if the timestamp is in the future', () => {
    expect(widgetTimestamp('2099-01-01T00:00:00Z', 'en')?.iso).toBe('2099-01-01T00:00:00.000Z')
    expect(widgetTimestamp('2099-01-01T00:00:00Z', 'ko')?.label).toContain('UTC')
    expect(widgetTimestamp('invalid', 'en')).toBeNull()
    expect(widgetTimestamp(null, 'en')).toBeNull()
  })
  it('separates zero proportions from invalid and negative pie values', () => {
    const spec = ChartSpec.parse({ type: 'pie', title: 'Example', category: 'name', value: 'value' })
    const data = (values: unknown[]) => ({ columns: ['name', 'value'], rows: values.map((value, i) => ({ name: String(i), value })) })
    expect(chartDataIssue(spec, data([0, '0']))).toBe('zeroTotal')
    for (const values of [[-1, 2], [null, 2], ['text', 2]]) expect(chartDataIssue(spec, data(values))).toBe('needsNonNegativeValues')
    expect(chartDataIssue(spec, data([0, '2']))).toBeNull()
  })
  it('requires paired numeric scatter values, not separate numeric x/y rows', () => {
    const spec = ChartSpec.parse({ type: 'scatter', title: 'Example', x: 'x', y: 'y' })
    expect(chartDataIssue(spec, { columns: ['x', 'y'], rows: [{ x: 1, y: null }, { x: null, y: 2 }] })).toBe('needsNumericColumns')
    expect(chartDataIssue(spec, { columns: ['x', 'y'], rows: [{ x: '0', y: 0 }] })).toBeNull()
  })
  it('retains partial cartesian gaps and distinguishes no numbers from measured zero', () => {
    const spec = ChartSpec.parse({ type: 'line', title: 'Example', x: 'x', y: ['a', 'b'] })
    const data = (rows: Record<string, unknown>[]) => ({ columns: ['x', 'a', 'b'], rows })
    expect(chartDataIssue(spec, data([{ x: 'date', a: 'text', b: null }]))).toBe('needsNumericValues')
    expect(chartDataIssue(spec, data([{ x: 'date', a: null, b: 0 }]))).toBeNull()
  })
  it('reserves negative-axis labels without cancelling stacked extents', () => {
    expect(maxSeriesValue([{ a: -1000, b: 1 }], ['a', 'b'])).toBe(-1000)
    expect(maxSeriesValue([{ a: -1000, b: 1000 }], ['a', 'b'], true)).toBe(-1000)
    expect(maxSeriesValue([{ a: 600, b: 500 }], ['a', 'b'], true)).toBe(1100)
    expect(maxSeriesValue([{ a: null, b: 'no number' }], ['a', 'b'])).toBe(0)
  })
})
