import { beforeEach, describe, expect, it } from 'vitest'

import { formatTick, formatValue, setVizLocale } from './format'

beforeEach(() => setVizLocale('ko'))

describe('formatValue — compact currency (the ₩1억-for-₩1.4억 regression)', () => {
  it('keeps one mantissa fraction digit for compact KRW at the 억 scale', () => {
    // the bug: KRW's "no minor unit" rule zeroed fraction digits in compact notation,
    // truncating 141,200,000 to "₩1억" (~30% error) and colliding 120M/160M axis ticks.
    expect(formatValue(141_200_000, { kind: 'currency', currency: 'KRW', compact: true })).toBe('₩1.4억')
    expect(formatValue(120_000_000, { kind: 'currency', currency: 'KRW', compact: true })).toBe('₩1.2억')
    expect(formatValue(160_000_000, { kind: 'currency', currency: 'KRW', compact: true })).toBe('₩1.6억')
    // whole mantissas don't grow trailing zeros
    expect(formatValue(200_000_000, { kind: 'currency', currency: 'KRW', compact: true })).toBe('₩2억')
    expect(formatValue(40_000_000, { kind: 'currency', currency: 'KRW', compact: true })).toBe('₩4000만')
  })

  it('still drops minor units for standard-notation KRW', () => {
    expect(formatValue(1234.56, { kind: 'currency', currency: 'KRW' })).toBe('₩1,235')
  })

  it('honors an explicit decimals override in compact notation', () => {
    expect(formatValue(141_200_000, { kind: 'currency', currency: 'KRW', compact: true, decimals: 0 })).toBe('₩1억')
  })

  it('non-KRW currencies keep 2 standard fraction digits and 1 compact mantissa digit', () => {
    expect(formatValue(1234.56, { kind: 'currency', currency: 'USD' })).toContain('1,234.56')
    expect(formatValue(1_410_000, { kind: 'currency', currency: 'USD', compact: true })).toContain('141')
  })
})

describe('formatValue — percent stays fraction-based', () => {
  it('multiplies fractions by 100', () => {
    expect(formatValue(0.146, { kind: 'percent' })).toBe('14.6%')
  })
})

describe('formatValue — compact keeps the unit suffix', () => {
  it('appends unit exactly like the plain number branch (regression: compact silently dropped it)', () => {
    expect(formatValue(1500, { kind: 'compact', unit: '건' })).toMatch(/건$/)
    expect(formatValue(1500, { kind: 'number', unit: '건' })).toMatch(/건$/)
  })

  it('renders without a suffix when no unit is set', () => {
    expect(formatValue(1500, { kind: 'compact' })).not.toMatch(/undefined/)
  })
})

describe('formatTick — axis ticks drop the year for day/datetime dates', () => {
  it('PIN: day granularity renders year-less (full dates × every tick × -35° swamped small cells)', () => {
    const f = { kind: 'date', dateGranularity: 'day' } as const
    expect(formatTick('2026-06-23', f)).toBe('6. 23.')
    // the tooltip path (formatValue) keeps the full date — the year lives there
    expect(formatValue('2026-06-23', f)).toContain('2026')
  })

  it('month/quarter/year granularities keep the year — there it IS the signal', () => {
    expect(formatTick('2026-06-01', { kind: 'date', dateGranularity: 'month' })).toContain('2026')
    expect(formatTick('2026-06-01', { kind: 'date', dateGranularity: 'year' })).toContain('2026')
  })

  it('non-date formats defer to formatValue verbatim', () => {
    expect(formatTick(141_200_000, { kind: 'currency', currency: 'KRW', compact: true })).toBe('₩1.4억')
    expect(formatTick('의류', { kind: 'string' })).toBe('의류')
  })
})
