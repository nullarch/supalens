import { describe, expect, it } from 'vitest'
import { monitorDisplayHealth, monitorSummary, reconnectMonitorCount } from './presentation'

describe('monitor presentation', () => {
  const base = { enabled: true, status: 'normal', lastError: null, lastCheckedAt: null }
  it('counts only recognized, recorded authorization faults on enabled monitors', () => {
    const monitors = [
      { ...base, lastError: 'reconnect_required' },
      { ...base, lastError: 'reconnect_required', enabled: false },
      { ...base, lastError: 'query timeout' },
      { ...base, lastError: 'reconnect_required in raw text' },
      base,
    ]
    const before = structuredClone(monitors)
    expect(reconnectMonitorCount(monitors)).toBe(1)
    expect(reconnectMonitorCount([])).toBe(0)
    expect(monitors).toEqual(before)
  })
  it('does not call an unevaluated monitor healthy', () => {
    expect(monitorDisplayHealth(base)).toBe('pending')
    expect(monitorDisplayHealth({ ...base, lastCheckedAt: '2026-09-06T00:00:00Z' })).toBe('healthy')
  })
  it('preserves paused, incident and failed precedence', () => {
    expect(monitorDisplayHealth({ ...base, enabled: false, status: 'firing', lastError: 'timeout' })).toBe('paused')
    expect(monitorDisplayHealth({ ...base, status: 'firing', lastError: 'timeout' })).toBe('incident')
    expect(monitorDisplayHealth({ ...base, lastError: 'timeout' })).toBe('error')
  })
  it('never presents empty, paused, pending or failed collections as all healthy', () => {
    const empty = { all: 0, healthy: 0, incident: 0, error: 0, pending: 0, paused: 0 }
    expect(monitorSummary(empty)).toBe('empty')
    for (const status of ['paused', 'pending', 'error', 'healthy', 'incident'] as const) {
      expect(monitorSummary({ ...empty, all: 1, [status]: 1 })).toBe(status)
    }
    expect(monitorSummary({ ...empty, all: 3, healthy: 1, error: 1, pending: 1 })).toBe('error')
    expect(monitorSummary({ ...empty, all: 2, incident: 1, error: 1 })).toBe('incident')
  })
})
