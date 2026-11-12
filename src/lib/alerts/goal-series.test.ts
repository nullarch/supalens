import { describe, expect, it } from 'vitest'

import { checkGoalSeries, minHistoryFor } from './goal-series'
import type { MonitorCondition } from './condition'

const NOW = Date.parse('2026-09-27T05:00:00Z')
const down: MonitorCondition = { v: 1, strategy: 'anomaly', direction: 'down', sensitivity: 3, window: 28 }

function days(values: number[], lastDay = '2026-09-26') {
  const end = Date.parse(`${lastDay}T00:00:00Z`)
  return values.map((v, i) => ({ day: new Date(end - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), v }))
}
const base = Array.from({ length: 40 }, (_, i) => 50 + (i % 5) - 2)

describe('checkGoalSeries', () => {
  it('accepts a complete daily series and reports the current verdict + backtest', () => {
    const r = checkGoalSeries(['day', 'v'], days([...base, 10]), down, NOW, 'UTC')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.check.current.met).toBe(true)
      expect(r.check.backtest.fires).toBe(1)
      expect(r.check.points).toHaveLength(41)
    }
  })

  it('drops the in-progress day before judging history', () => {
    const r = checkGoalSeries(['day', 'v'], days([...base, 50, 2], '2026-09-27'), down, NOW, 'UTC')
    expect(r.ok && r.check.droppedInProgress).toBe(1)
    expect(r.ok && r.check.current.met).toBe(false)
  })

  it('rejects a scalar (one column)', () => {
    const r = checkGoalSeries(['n'], [{ n: 3 }], down, NOW, 'UTC')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/generate_series/)
  })

  it('rejects missing days — a drop to zero must be representable', () => {
    const rows = days(base)
    rows.splice(10, 1)
    const r = checkGoalSeries(['day', 'v'], rows, down, NOW, 'UTC')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/must appear as 0/)
  })

  it('rejects descending / duplicate days', () => {
    expect(checkGoalSeries(['day', 'v'], days(base).reverse(), down, NOW, 'UTC').ok).toBe(false)
    const dup = days(base)
    dup.push({ ...dup[dup.length - 1] })
    expect(checkGoalSeries(['day', 'v'], dup, down, NOW, 'UTC').ok).toBe(false)
  })

  it('rejects a non-date bucket and a non-numeric measure', () => {
    expect(checkGoalSeries(['label', 'v'], [{ label: 'a', v: 1 }, { label: 'b', v: 2 }], down, NOW, 'UTC').ok).toBe(false)
    const rows: Record<string, unknown>[] = days(base)
    rows[3] = { ...rows[3], v: null }
    const r = checkGoalSeries(['day', 'v'], rows, down, NOW, 'UTC')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/coalesce/)
  })

  it('requires enough history for the strategy', () => {
    expect(minHistoryFor(down)).toBe(8)
    const r = checkGoalSeries(['day', 'v'], days([50, 51, 49]), down, NOW, 'UTC')
    expect(r.ok).toBe(false)
  })

  it('rejects a series that stops days ago (it would evaluate a stale day forever)', () => {
    const r = checkGoalSeries(['day', 'v'], days(base, '2026-09-10'), down, NOW, 'UTC')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/most recent complete day/)
  })
})
