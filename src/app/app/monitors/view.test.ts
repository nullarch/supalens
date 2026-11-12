import { describe, expect, it } from 'vitest'

import { MONITORS_VIEWS, monitorsViewHref, parseMonitorsView } from './view'

/**
 * Pins the merged 감시 screen's URL contract. Monitors and incidents are one route with two views,
 * and the links that reach them (the view switch, the queue's own status filter, the incident
 * detail's back link, /app/incidents' redirect) are all built here — so a change to the shape shows
 * up as a failing pin rather than as a dead link somewhere in the app.
 */
describe('monitors view routing', () => {
  it('defaults to the monitors list for anything but ?view=incidents', () => {
    expect(parseMonitorsView(undefined)).toBe('monitors')
    expect(parseMonitorsView(null)).toBe('monitors')
    expect(parseMonitorsView('')).toBe('monitors')
    expect(parseMonitorsView('monitors')).toBe('monitors')
    expect(parseMonitorsView('nonsense')).toBe('monitors')
    expect(parseMonitorsView('incidents')).toBe('incidents')
  })

  it('keeps the two views on one route, monitors first', () => {
    expect(MONITORS_VIEWS).toEqual(['monitors', 'incidents'])
    expect(monitorsViewHref('monitors')).toBe('/app/monitors')
    expect(monitorsViewHref('incidents')).toBe('/app/monitors?view=incidents')
    // every view link stays inside the one route
    for (const v of MONITORS_VIEWS) expect(monitorsViewHref(v).startsWith('/app/monitors')).toBe(true)
  })

  it('carries the queue filter alongside the view, and leaves the default out', () => {
    expect(monitorsViewHref('incidents', 'openish')).toBe('/app/monitors?view=incidents')
    expect(monitorsViewHref('incidents', null)).toBe('/app/monitors?view=incidents')
    expect(monitorsViewHref('incidents', 'all')).toBe('/app/monitors?view=incidents&status=all')
    expect(monitorsViewHref('incidents', 'investigating')).toBe('/app/monitors?view=incidents&status=investigating')
  })

  it('ignores a filter on the monitors view and never lets one escape the path', () => {
    expect(monitorsViewHref('monitors', 'all')).toBe('/app/monitors')
    // /app/incidents forwards an unvalidated ?status= — it may only ever be an encoded query value
    expect(monitorsViewHref('incidents', '../../evil?x=1')).toBe(
      '/app/monitors?view=incidents&status=..%2F..%2Fevil%3Fx%3D1',
    )
  })
})
