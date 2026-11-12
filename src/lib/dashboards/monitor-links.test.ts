import { describe, expect, it } from 'vitest'

import {
  matchMonitorLinks,
  normalizeSql,
  openIncidentByAlert,
  type AlertRef,
  type AppliedRef,
  type EventRef,
  type WidgetRef,
} from './monitor-links'

const alert = (over: Partial<AlertRef> = {}): AlertRef => ({
  id: 'a1',
  dataSourceId: 'ds1',
  metricSql: 'select sum(amount) from orders',
  status: 'normal',
  enabled: true,
  lastCheckedAt: '2026-09-04T10:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  ...over,
})

const widget = (over: Partial<WidgetRef> = {}): WidgetRef => ({
  id: 'w1',
  dataSourceId: 'ds1',
  sql: 'select sum(amount) from orders',
  ...over,
})

describe('normalizeSql', () => {
  it('collapses whitespace and drops trailing semicolons', () => {
    expect(normalizeSql('select  a\n  from   t ;')).toBe('select a from t')
    expect(normalizeSql('  select a from t\n\n')).toBe('select a from t')
  })

  it('does NOT fold case — a literal is part of the metric', () => {
    expect(normalizeSql("where c = 'KR'")).not.toBe(normalizeSql("where c = 'kr'"))
  })
})

describe('openIncidentByAlert', () => {
  const ev = (id: string, alertId: string, kind: string, createdAt: string): EventRef => ({ id, alertId, kind, createdAt })

  it('an alert whose newest event is fired has an open incident', () => {
    const out = openIncidentByAlert([ev('e2', 'a1', 'fired', '2026-09-04T09:00:00Z'), ev('e1', 'a1', 'resolved', '2026-09-03T09:00:00Z')])
    expect(out).toEqual({ a1: 'e2' })
  })

  it('a later resolved row closes it', () => {
    const out = openIncidentByAlert([ev('e2', 'a1', 'resolved', '2026-09-04T09:00:00Z'), ev('e1', 'a1', 'fired', '2026-09-03T09:00:00Z')])
    expect(out).toEqual({})
  })

  it('is per alert and order-independent', () => {
    const out = openIncidentByAlert([
      ev('e1', 'a1', 'fired', '2026-09-01T00:00:00Z'),
      ev('e3', 'a2', 'fired', '2026-09-04T00:00:00Z'),
      ev('e2', 'a1', 'resolved', '2026-09-02T00:00:00Z'),
    ])
    expect(out).toEqual({ a2: 'e3' })
  })
})

describe('matchMonitorLinks', () => {
  it('prefers recorded provenance over SQL identity', () => {
    const applied: AppliedRef[] = [{ widgetId: 'w1', alertId: 'a2' }]
    const alerts = [alert({ id: 'a1' }), alert({ id: 'a2', enabled: false })]
    const out = matchMonitorLinks([widget()], alerts, applied, [])
    expect(out.w1).toMatchObject({ alertId: 'a2', via: 'provenance', enabled: false })
  })

  it('falls back to same-source SQL identity, ignoring formatting', () => {
    const out = matchMonitorLinks([widget({ sql: 'select   sum(amount)\nfrom orders;' })], [alert()], [], [])
    expect(out.w1).toMatchObject({ alertId: 'a1', via: 'sql' })
  })

  it('never links across data sources or across different metrics', () => {
    const other = matchMonitorLinks([widget({ dataSourceId: 'ds2' })], [alert()], [], [])
    expect(other.w1).toBeUndefined()
    const differs = matchMonitorLinks([widget({ sql: 'select count(*) from orders' })], [alert()], [], [])
    expect(differs.w1).toBeUndefined()
  })

  it('leaves a widget with no data source or no SQL unlinked', () => {
    const out = matchMonitorLinks([widget({ id: 'w1', dataSourceId: null }), widget({ id: 'w2', sql: null })], [alert()], [], [])
    expect(out).toEqual({})
  })

  it('picks the enabled monitor when two watch the same SQL, then the newest', () => {
    const alerts = [
      alert({ id: 'old', enabled: false, createdAt: '2026-09-01T00:00:00Z' }),
      alert({ id: 'live', enabled: true, createdAt: '2026-08-01T00:00:00Z' }),
    ]
    expect(matchMonitorLinks([widget()], alerts, [], []).w1).toMatchObject({ alertId: 'live' })

    const bothLive = [
      alert({ id: 'older', createdAt: '2026-08-01T00:00:00Z' }),
      alert({ id: 'newer', createdAt: '2026-09-01T00:00:00Z' }),
    ]
    expect(matchMonitorLinks([widget()], bothLive, [], []).w1).toMatchObject({ alertId: 'newer' })
  })

  it('carries the firing status and the open incident id through', () => {
    const alerts = [alert({ status: 'firing' })]
    const events: EventRef[] = [{ id: 'e9', alertId: 'a1', kind: 'fired', createdAt: '2026-09-04T09:00:00Z' }]
    expect(matchMonitorLinks([widget()], alerts, [], events).w1).toMatchObject({
      status: 'firing',
      openIncidentEventId: 'e9',
    })
  })

  it('ignores provenance pointing at a deleted monitor (not in the alert set)', () => {
    const out = matchMonitorLinks([widget({ sql: null })], [], [{ widgetId: 'w1', alertId: 'gone' }], [])
    expect(out).toEqual({})
  })
})
