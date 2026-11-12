import { describe, expect, it } from 'vitest'

import { ANOMALY_SERIES_MAX } from './evaluate'
import { evaluateMonitorResult, monitorMaxRows } from './monitor-eval'
import type { MonitorCondition } from './condition'

const NOW = Date.parse('2026-09-27T05:00:00Z')
const down: MonitorCondition = { v: 1, strategy: 'anomaly', direction: 'down', sensitivity: 3, window: 28 }

function days(values: number[], lastDay = '2026-09-26'): { columns: string[]; rows: Record<string, unknown>[] } {
  const end = Date.parse(`${lastDay}T00:00:00Z`)
  const rows = values.map((v, i) => ({
    day: new Date(end - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    v,
  }))
  return { columns: ['day', 'v'], rows }
}

const base = Array.from({ length: 28 }, (_, i) => 50 + (i % 5) - 2)

describe('monitorMaxRows', () => {
  it('reads a series for goal and legacy anomaly monitors, one scalar otherwise', () => {
    expect(monitorMaxRows({ type: 'threshold', condition: down })).toBe(ANOMALY_SERIES_MAX)
    expect(monitorMaxRows({ type: 'anomaly' })).toBe(ANOMALY_SERIES_MAX)
    expect(monitorMaxRows({ type: 'threshold' })).toBe(1)
  })
})

describe('evaluateMonitorResult — goal monitors', () => {
  const m = { type: 'anomaly', operator: 'gt' as const, threshold: 0, sensitivity: 3, condition: down }

  it('evaluates the latest COMPLETE bucket', () => {
    const r = evaluateMonitorResult(m, days([...base, 10]), NOW, 'UTC')
    expect(r.ok && r.met).toBe(true)
    expect(r.ok && r.detail.kind === 'goal' && r.detail.bucket).toBe('2026-09-26')
  })

  it("ignores today's partial bucket instead of reading it as a collapse", () => {
    // yesterday was normal; today has only a few hours of data
    const res = days([...base, 50, 3], '2026-09-27')
    const r = evaluateMonitorResult(m, res, NOW, 'UTC')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.met).toBe(false)
      expect(r.value).toBe(50)
      expect(r.detail.kind === 'goal' && r.detail.droppedInProgress).toBe(1)
    }
  })

  it('refuses a truncated series (the newest points were cut)', () => {
    expect(evaluateMonitorResult(m, { ...days(base), truncated: true }, NOW, 'UTC')).toEqual({ ok: false, code: 'series_too_long' })
  })

  it('reports an empty series once in-progress buckets are removed', () => {
    expect(evaluateMonitorResult(m, days([3], '2026-09-27'), NOW, 'UTC')).toEqual({ ok: false, code: 'series_too_short' })
  })
})

describe('evaluateMonitorResult — legacy monitors are unchanged', () => {
  it('threshold: one scalar vs operator', () => {
    const r = evaluateMonitorResult({ type: 'threshold', operator: 'lt', threshold: 10, sensitivity: null }, { columns: ['n'], rows: [{ n: 4 }] }, NOW, 'UTC')
    expect(r).toEqual({ ok: true, value: 4, met: true, detail: { kind: 'threshold' } })
    expect(evaluateMonitorResult({ type: 'threshold', operator: 'lt', threshold: 10, sensitivity: null }, { columns: ['n'], rows: [] }, NOW, 'UTC')).toEqual({
      ok: false,
      code: 'no_scalar',
    })
  })
  it('anomaly: two-sided over the whole series, today included (legacy semantics)', () => {
    const r = evaluateMonitorResult({ type: 'anomaly', operator: 'gt', threshold: 0, sensitivity: 3 }, days([...base, 200]), NOW, 'UTC')
    expect(r.ok && r.met).toBe(true)
    expect(r.ok && r.detail.kind).toBe('legacy_anomaly')
  })
})
