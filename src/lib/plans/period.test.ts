import { describe, expect, it } from 'vitest'

import { addMonthsClamped } from './period'

// Pin the end-of-month clamping (regression: setMonth(+1) overflowed short months, drifting the
// free-plan billing window end by 1-3 days — Jan 31 → Mar 3, May 31 → Jul 1).
describe('addMonthsClamped', () => {
  const iso = (s: string) => new Date(s)

  it('adds a plain month when the day exists in the target month', () => {
    expect(addMonthsClamped(iso('2026-03-15T10:00:00.000Z'), 1).toISOString()).toBe('2026-04-15T10:00:00.000Z')
  })

  it('clamps Jan 31 to Feb 28 (non-leap)', () => {
    expect(addMonthsClamped(iso('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
  })

  it('clamps Jan 31 to Feb 29 on a leap year', () => {
    expect(addMonthsClamped(iso('2028-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })

  it('clamps May 31 to Jun 30 instead of overflowing to Jul 1', () => {
    expect(addMonthsClamped(iso('2026-05-31T23:59:59.000Z'), 1).toISOString()).toBe('2026-06-30T23:59:59.000Z')
  })

  it('preserves the time-of-day', () => {
    expect(addMonthsClamped(iso('2026-07-16T09:30:15.250Z'), 1).toISOString()).toBe('2026-08-16T09:30:15.250Z')
  })

  it('crosses year boundaries', () => {
    expect(addMonthsClamped(iso('2026-12-31T00:00:00.000Z'), 1).toISOString()).toBe('2027-01-31T00:00:00.000Z')
  })
})
