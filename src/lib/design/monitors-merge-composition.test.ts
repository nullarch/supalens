import { describe, expect, it, vi } from 'vitest'

import * as view from '@/app/app/monitors/view'
import { common, localClient, oneElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

/**
 * Monitors and incidents are ONE screen: /app/monitors renders the monitors list by default and the
 * incidents queue at ?view=incidents, and /app/incidents redirects into it. This runs the real route
 * modules with local dependencies only (no Next RSC, no database) to pin that composition:
 *
 *  - both views hang off the one route, under one view switch carrying both counts
 *  - the incidents view does NOT pay for the monitors view's reads (sources, role, plan, targets)
 *  - the queue keeps its own ?status= filter alongside ?view=
 *
 * The /app/incidents redirect that feeds this route is pinned in app/app/redirect-contracts.test.ts,
 * and the link builder itself in app/app/monitors/view.test.ts.
 */

const ALERTS = [{ id: 'monitor-a' }, { id: 'monitor-b' }]
const INCIDENTS = [
  { id: 'incident-open', status: 'open' },
  { id: 'incident-investigating', status: 'investigating' },
  { id: 'incident-resolved', status: 'resolved' },
]

/** Load app/monitors/page.tsx with every dependency local; `./view` is the REAL link builder. */
function monitorsRoute(
  over: {
    alerts?: () => Promise<unknown>
    incidents?: () => Promise<unknown>
    signedIn?: boolean
  } = {},
) {
  const { client } = localClient(
    { organization_members: [{ role: 'admin' }], organizations: [{ plan: 'sample-plan' }] },
    over.signedIn ?? true,
  )
  const listActiveDataSources = vi.fn(async () => [{ id: 'source-a' }])
  const getNotificationTargets = vi.fn(async () => ({ email: true }))
  const parseFilter = vi.fn((value: string | undefined) => value ?? 'openish')
  const page = loadRoute('app/monitors/page.tsx', {
    ...common,
    '@/utils/supabase/server': { createClient: async () => client },
    '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' },
    '@/lib/alerts/server': {
      listAlerts: over.alerts ?? (async () => ALERTS),
      listActiveDataSources,
      getNotificationTargets,
    },
    '@/lib/alerts/incidents-server': {
      listIncidents: over.incidents ?? (async () => ({ incidents: INCIDENTS, ackReady: true })),
    },
    '@/lib/alerts/evaluate': { effectiveCheckInterval: (value: number) => value },
    '@/lib/plans/limits': { getPlanLimit: () => 300 },
    '@/lib/org/timezone': { getOrgTimezone: async () => 'Asia/Seoul' },
    '../incidents/IncidentsTable': { IncidentsTable: 'IncidentsTable', parseFilter },
    './MonitorsManager': { MonitorsManager: 'MonitorsManager' },
    './ViewSwitch': { ViewSwitch: 'ViewSwitch' },
    './view': view,
  })
  return { page, listActiveDataSources, getNotificationTargets, parseFilter }
}

const render = (page: { default: (...a: unknown[]) => unknown }, searchParams: Record<string, string> = {}) =>
  page.default({ searchParams: Promise.resolve(searchParams) })

describe('the merged 감시 screen', () => {
  it('renders the monitors list under the view switch by default', async () => {
    const { page, listActiveDataSources, getNotificationTargets } = monitorsRoute()
    const tree = await render(page)

    expect(oneElement(tree, 'ViewSwitch').props).toEqual({ view: 'monitors', counts: { monitors: 2, incidents: 2 } })
    expect(oneElement(tree, 'MonitorsManager').props).toMatchObject({
      alerts: ALERTS,
      timezone: 'Asia/Seoul',
      canManage: true,
      canConfigure: true,
    })
    expect(listActiveDataSources).toHaveBeenCalledOnce()
    expect(getNotificationTargets).toHaveBeenCalledOnce()
  })

  it('renders the incidents queue on the same route at ?view=incidents', async () => {
    const { page, parseFilter, listActiveDataSources, getNotificationTargets } = monitorsRoute()
    const tree = await render(page, { view: 'incidents' })

    expect(oneElement(tree, 'ViewSwitch').props).toEqual({ view: 'incidents', counts: { monitors: 2, incidents: 2 } })
    expect(oneElement(tree, 'IncidentsTable').props).toEqual({
      incidents: INCIDENTS,
      filter: 'openish',
      timezone: 'Asia/Seoul',
    })
    expect(parseFilter).toHaveBeenCalledExactlyOnceWith(undefined)
    // the queue must not pay for the monitors view's reads
    expect(listActiveDataSources).not.toHaveBeenCalled()
    expect(getNotificationTargets).not.toHaveBeenCalled()
  })

  it('keeps the queue filter working alongside the view param', async () => {
    const { page, parseFilter } = monitorsRoute()
    const tree = await render(page, { view: 'incidents', status: 'all' })
    expect(parseFilter).toHaveBeenCalledExactlyOnceWith('all')
    expect(oneElement(tree, 'IncidentsTable').props.filter).toBe('all')
  })

  it('drops only the other view’s count when its read fails, never the rendered view', async () => {
    const failing = async () => {
      throw new Error('sample read failure')
    }
    // the harness gives the route its own silent console, so the swallowed log stays out of the run
    const monitors = await render(monitorsRoute({ incidents: failing }).page)
    expect(oneElement(monitors, 'ViewSwitch').props.counts).toEqual({ monitors: 2, incidents: 0 })
    expect(oneElement(monitors, 'MonitorsManager')).toBeTruthy()

    const incidents = await render(monitorsRoute({ alerts: failing }).page, { view: 'incidents' })
    expect(oneElement(incidents, 'ViewSwitch').props.counts).toEqual({ monitors: 0, incidents: 2 })
    expect(oneElement(incidents, 'IncidentsTable')).toBeTruthy()

    // the RENDERED view keeps its deliberate throw — an empty list must never read as an all-clear
    await expect(render(monitorsRoute({ alerts: failing }).page)).rejects.toThrow('sample read failure')
    await expect(render(monitorsRoute({ incidents: failing }).page, { view: 'incidents' })).rejects.toThrow(
      'sample read failure',
    )
  })

  it('sends a signed-out visitor back to the view they asked for', async () => {
    const { page } = monitorsRoute({ signedIn: false })
    await expect(render(page)).rejects.toThrow('REDIRECT:/login?next=%2Fapp%2Fmonitors')
    await expect(render(page, { view: 'incidents', status: 'all' })).rejects.toThrow(
      'REDIRECT:/login?next=%2Fapp%2Fmonitors%3Fview%3Dincidents%26status%3Dall',
    )
  })
})
