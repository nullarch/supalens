import { describe, expect, it } from 'vitest'

import {
  backtestCondition,
  bucketDateOf,
  conditionViewOf,
  dateInZone,
  dropInProgress,
  evaluateCondition,
  legacyColumnsFor,
  parseCondition,
  seriesPointsFromRows,
  type MonitorCondition,
} from './condition'

const anomaly = (over: Partial<Extract<MonitorCondition, { strategy: 'anomaly' }>> = {}): MonitorCondition => ({
  v: 1,
  strategy: 'anomaly',
  direction: 'down',
  sensitivity: 3,
  window: 28,
  ...over,
})

/** 28 days of ~50/day with a little spread, then `last`. */
function daily(last: number, base = [48, 52, 50, 47, 53, 49, 51]): number[] {
  const out: number[] = []
  for (let i = 0; i < 28; i++) out.push(base[i % base.length])
  out.push(last)
  return out
}

describe('parseCondition', () => {
  it('accepts every strategy and rejects malformed / unknown shapes', () => {
    expect(parseCondition(anomaly())).not.toBeNull()
    expect(parseCondition({ v: 1, strategy: 'relative', direction: 'down', pct: 0.3, window: 7 })).not.toBeNull()
    expect(parseCondition({ v: 1, strategy: 'absolute', operator: 'gt', threshold: 5 })).not.toBeNull()
    expect(parseCondition(null)).toBeNull()
    expect(parseCondition({ v: 2, strategy: 'anomaly', direction: 'down', sensitivity: 3, window: 28 })).toBeNull()
    expect(parseCondition({ v: 1, strategy: 'anomaly', direction: 'sideways', sensitivity: 3, window: 28 })).toBeNull()
    // an anomaly window below the minimum baseline could never fire
    expect(parseCondition(anomaly({ window: 3 }))).toBeNull()
  })
})

describe('bucketDateOf', () => {
  it('reads literal dates and timestamps from strings', () => {
    expect(bucketDateOf('2026-09-27')).toBe('2026-09-27')
    expect(bucketDateOf('2026-09-27 00:00:00+00')).toBe('2026-09-27')
    expect(bucketDateOf('2026-09-27T15:00:00.000Z')).toBe('2026-09-27')
    expect(bucketDateOf('Sep 27')).toBeNull()
    expect(bucketDateOf(42)).toBeNull()
  })
  it('reads a pg `date` (local midnight Date) by its local calendar date', () => {
    expect(bucketDateOf(new Date(2026, 8, 27))).toBe('2026-09-27')
  })
})

describe('seriesPointsFromRows', () => {
  it('takes the bucket from the first column and the value from the last', () => {
    const pts = seriesPointsFromRows(['day', 'signups'], [
      { day: '2026-09-25', signups: '10' },
      { day: '2026-09-26', signups: null },
      { day: '2026-09-27', signups: 12 },
    ])
    expect(pts).toEqual([
      { bucket: '2026-09-25', value: 10 },
      { bucket: '2026-09-27', value: 12 },
    ])
  })
})

describe('dropInProgress', () => {
  const pts = [
    { bucket: '2026-09-25', value: 1 },
    { bucket: '2026-09-26', value: 2 },
    { bucket: '2026-09-27', value: 3 },
  ]
  it('drops today (UTC) — a partial day must never be compared against full days', () => {
    const now = Date.parse('2026-09-27T05:00:00Z')
    const r = dropInProgress(pts, now, 'UTC')
    expect(r.dropped).toBe(1)
    expect(r.points.at(-1)?.bucket).toBe('2026-09-26')
  })
  it('uses the EARLIER of UTC-today and org-today (west of UTC: the org day is still running)', () => {
    // 02:00Z on the 28th = 19:00 on the 27th in Los Angeles → the 27th is still in progress there
    const now = Date.parse('2026-09-28T02:00:00Z')
    expect(dropInProgress(pts, now, 'America/Los_Angeles').points.at(-1)?.bucket).toBe('2026-09-26')
    // in UTC the 27th is complete
    expect(dropInProgress(pts, now, 'UTC').points.at(-1)?.bucket).toBe('2026-09-27')
  })
  it('keeps points without a readable bucket', () => {
    const r = dropInProgress([{ bucket: null, value: 1 }], Date.parse('2026-09-27T05:00:00Z'), 'UTC')
    expect(r.dropped).toBe(0)
  })
  it('falls back to UTC on an unknown zone', () => {
    expect(dateInZone(Date.parse('2026-09-27T05:00:00Z'), 'Mars/Olympus')).toBe('2026-09-27')
  })
})

describe('evaluateCondition — anomaly', () => {
  it('fires on a drop but NOT on a surge when the direction is down', () => {
    expect(evaluateCondition(daily(20), anomaly()).met).toBe(true)
    expect(evaluateCondition(daily(200), anomaly()).met).toBe(false)
    expect(evaluateCondition(daily(200), anomaly({ direction: 'up' })).met).toBe(true)
    expect(evaluateCondition(daily(200), anomaly({ direction: 'both' })).met).toBe(true)
  })
  it('stays quiet for normal variation', () => {
    expect(evaluateCondition(daily(46), anomaly({ direction: 'both' })).met).toBe(false)
  })
  it('uses only the trailing window — old history does not anchor the baseline after growth', () => {
    // 60 days at ~10/day, then 28 days at ~100/day; 95 today is normal for the NEW level
    const old = Array.from({ length: 60 }, (_, i) => 10 + (i % 3))
    const recent = Array.from({ length: 28 }, (_, i) => 98 + (i % 5))
    const series = [...old, ...recent, 95]
    expect(evaluateCondition(series, anomaly({ direction: 'both' })).met).toBe(false)
    // …whereas a full-history baseline would have called the whole new level an outlier
    expect(evaluateCondition(series, anomaly({ direction: 'both', window: 90 })).mean).toBeLessThan(60)
  })
  it('needs a minimum baseline before it can fire', () => {
    const r = evaluateCondition([50, 50, 50, 0], anomaly())
    expect(r.insufficient).toBe(true)
    expect(r.met).toBe(false)
  })
  it('floors a flat baseline so a 1% wobble is not an infinite-sigma anomaly', () => {
    const flat = [...Array(28).fill(100), 99]
    const r = evaluateCondition(flat, anomaly({ direction: 'both' }))
    expect(r.met).toBe(false)
    expect(Number.isFinite(r.z)).toBe(true)
    // but a 20% move on a flat metric is flagged
    expect(evaluateCondition([...Array(28).fill(100), 80], anomaly()).met).toBe(true)
  })
  it('exposes the expected band on the watched side only', () => {
    const r = evaluateCondition(daily(50), anomaly())
    expect(r.lower).not.toBeNull()
    expect(r.upper).toBeNull()
  })
})

describe('evaluateCondition — relative', () => {
  const rel = (direction: 'down' | 'up', pct = 0.3, window = 7): MonitorCondition => ({ v: 1, strategy: 'relative', direction, pct, window })
  it('compares the latest point with the trailing average', () => {
    const week = [100, 100, 100, 100, 100, 100, 100]
    expect(evaluateCondition([...week, 65], rel('down')).met).toBe(true)
    expect(evaluateCondition([...week, 75], rel('down')).met).toBe(false)
    expect(evaluateCondition([...week, 135], rel('up')).met).toBe(true)
    expect(evaluateCondition([...week, 65], rel('down')).change).toBeCloseTo(-0.35)
  })
  it('waits for a full window and never divides by a zero baseline', () => {
    expect(evaluateCondition([100, 50], rel('down')).insufficient).toBe(true)
    expect(evaluateCondition([0, 0, 0, 0, 0, 0, 0, 5], rel('up')).met).toBe(false)
  })
})

describe('evaluateCondition — absolute', () => {
  it('compares the latest point with the given number and inverts it into the expected range', () => {
    const c: MonitorCondition = { v: 1, strategy: 'absolute', operator: 'gt', threshold: 5 }
    expect(evaluateCondition([1, 2, 6], c).met).toBe(true)
    expect(evaluateCondition([1, 2, 4], c).met).toBe(false)
    expect(evaluateCondition([4], c).upper).toBe(5)
  })
})

describe('backtestCondition', () => {
  it('counts firing EDGES, not firing points, and reports where they happened', () => {
    const base = daily(50).slice(0, 28)
    // two separate dips, the first lasting two days
    const series = [...base, 10, 12, 50, 51, 49, 11, 50]
    const r = backtestCondition(series, anomaly())
    expect(r.fires).toBe(2)
    expect(r.firedIndices).toEqual([28, 33])
    expect(r.evaluated).toBeGreaterThan(0)
  })
  it('a looser sensitivity fires less (what the approval slider shows)', () => {
    const noisy = Array.from({ length: 90 }, (_, i) => 50 + ((i * 37) % 17) - 8)
    const tight = backtestCondition(noisy, anomaly({ direction: 'both', sensitivity: 1.5 })).fires
    const loose = backtestCondition(noisy, anomaly({ direction: 'both', sensitivity: 4 })).fires
    expect(loose).toBeLessThanOrEqual(tight)
  })
  it('respects fire_threshold (N consecutive hits)', () => {
    const base = daily(50).slice(0, 28)
    expect(backtestCondition([...base, 10, 50], anomaly(), { fireThreshold: 2 }).fires).toBe(0)
    expect(backtestCondition([...base, 10, 10], anomaly(), { fireThreshold: 2 }).fires).toBe(1)
  })
})

describe('legacy projection + view', () => {
  it('writes coherent legacy columns for older readers', () => {
    expect(legacyColumnsFor(anomaly({ sensitivity: 2.5 }))).toEqual({ type: 'anomaly', operator: 'gt', threshold: 0, sensitivity: 2.5 })
    expect(legacyColumnsFor({ v: 1, strategy: 'relative', direction: 'down', pct: 0.3, window: 7 }).type).toBe('change_rate')
    expect(legacyColumnsFor({ v: 1, strategy: 'absolute', operator: 'lt', threshold: 9 })).toEqual({
      type: 'threshold',
      operator: 'lt',
      threshold: 9,
      sensitivity: null,
    })
  })
  it('renders legacy rows and goal rows through one view', () => {
    expect(conditionViewOf({ type: 'anomaly', operator: 'gt', threshold: 0, sensitivity: 2 })).toEqual({
      kind: 'anomaly',
      direction: 'both',
      sensitivity: 2,
      window: null,
    })
    expect(conditionViewOf({ type: 'threshold', operator: 'lt', threshold: 4, sensitivity: null })).toEqual({
      kind: 'absolute',
      operator: 'lt',
      threshold: 4,
    })
    expect(conditionViewOf({ type: 'anomaly', operator: 'gt', threshold: 0, sensitivity: 3, condition: anomaly() })).toEqual({
      kind: 'anomaly',
      direction: 'down',
      sensitivity: 3,
      window: 28,
    })
  })
})
