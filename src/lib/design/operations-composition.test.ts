import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as activationLogic from '@/lib/activation/logic'
import * as health from '@/lib/alerts/health'
import * as evaluation from '@/lib/alerts/evaluate'
import * as monitorPresentation from '@/app/app/monitors/presentation'
import * as monitorsView from '@/app/app/monitors/view'
import * as overviewStage from '@/lib/activation/overview-stage'
import * as oauthErrors from '@/lib/supabase-oauth/errors'
import * as reportsBuild from '@/lib/reports/build'
import * as widgetSource from '@/lib/dashboards/widget-source'
import { common, localClient, oneElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

// The fixtures are dated mid-September 2026 and several rules are windows relative to "now"
// (e.g. a fresh context is news for a limited time), so the clock is pinned to that week. Only
// Date is faked — timers and promises run normally.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-18T00:00:00Z'))
})
afterAll(() => vi.useRealTimers())

describe('actual operational page assembly with local IO', () => {
  for (const role of ['owner', 'admin', 'member', 'viewer', undefined]) {
    it(`incident detail preserves evidence and uses the incident organization (${role})`, async () => {
      const { client, calls } = localClient({ alerts: [{ org_id: 'incident-org' }], organization_members: role ? [{ role }] : [] })
      const payload = { incident: { id: 'incident-a' }, alert: { id: 'alert-a' }, ackReady: false, metricSql: 'SELECT 1', description: 'Sample observed condition', snoozedUntil: null }
      const getIncident = vi.fn(async () => payload), timezone = vi.fn(async () => 'Asia/Tokyo')
      const page = loadRoute('app/incidents/[id]/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/alerts/incidents-server': { getIncident }, '@/lib/org/timezone': { getOrgTimezone: timezone },
        '../IncidentDetailView': { IncidentDetailView: 'IncidentDetailView' },
      })
      const view = oneElement(await page.default({ params: Promise.resolve({ id: 'incident-a' }) }), 'IncidentDetailView')
      expect(view.props).toEqual({ ...payload, timezone: 'Asia/Tokyo', canManage: ['owner', 'admin', 'member'].includes(role ?? '') })
      expect(getIncident).toHaveBeenCalledExactlyOnceWith(client, 'incident-a')
      expect(timezone).toHaveBeenCalledExactlyOnceWith(client, 'incident-org')
      expect(calls).toContainEqual(['organization_members', 'eq', 'org_id', 'incident-org'])
      expect(calls).toContainEqual(['organization_members', 'eq', 'user_id', 'user-a'])
    })
  }
  it('incident list passes all stored rows to the filter-aware view without fabricating results', async () => {
    // The queue is now the 감시 screen's second view (/app/monitors?view=incidents), so this pins it
    // through the merged route; /app/incidents is a redirect. See monitors-merge-composition.test.ts
    // for the rest of that merge (the view switch, the per-view reads, the redirect).
    const { client } = localClient({ organization_members: [{ role: 'admin' }], organizations: [{ plan: 'plan-a' }] })
    const rows = [{ id: 'open-a' }, { id: 'resolved-a' }]
    const list = vi.fn(async () => ({ incidents: rows })), parse = vi.fn(() => 'parsed-filter')
    const page = loadRoute('app/monitors/page.tsx', {
      ...common, '@/utils/supabase/server': { createClient: async () => client },
      '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' },
      '@/lib/alerts/server': { listAlerts: async () => [], listActiveDataSources: async () => [], getNotificationTargets: async () => ({}) },
      '@/lib/alerts/incidents-server': { listIncidents: list }, '@/lib/org/timezone': { getOrgTimezone: async () => 'UTC' },
      '@/lib/alerts/evaluate': { effectiveCheckInterval: (value: number) => value },
      '@/lib/plans/limits': { getPlanLimit: () => 300 },
      '../incidents/IncidentsTable': { IncidentsTable: 'IncidentsTable', parseFilter: parse },
      './MonitorsManager': { MonitorsManager: 'MonitorsManager' },
      './ViewSwitch': { ViewSwitch: 'ViewSwitch' },
      './view': monitorsView,
    })
    const view = oneElement(await page.default({ searchParams: Promise.resolve({ view: 'incidents', status: 'resolved' }) }), 'IncidentsTable')
    expect(view.props).toEqual({ incidents: rows, filter: 'parsed-filter', timezone: 'UTC' })
    expect(parse).toHaveBeenCalledExactlyOnceWith('resolved')
    expect(list).toHaveBeenCalledExactlyOnceWith(client, 'org-a')
  })
  for (const empty of [false, true]) {
    it(`report index preserves the populated/empty branch (${empty})`, async () => {
      const dashboards = empty ? [] : [{ id: 'report-a', slug: 'sales', title: 'Sales' }]
      const { client } = localClient()
      const page = loadRoute('app/dashboards/page.tsx', {
        'next/headers': { cookies: async () => ({ get: () => ({ value: 'workspace-a' }) }) },
        '@/lib/org/server': { ACTIVE_ORG_COOKIE: 'sample-active-org' },
        '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/dashboards/fetch': { listDashboards: async () => dashboards, resolveActiveOrgId: async () => 'org-a' },
        '@/lib/dashboards/home': { getHomeDashboardState: async () => ({ dashboards, home: dashboards[0] ?? null, chosen: false, settable: true }) },
        '@/lib/org/require-role': { userHasOrgRole: async () => true },
        './EmptyDashboards': { EmptyDashboards: 'EmptyDashboards' }, './ReportsIndex': { ReportsIndex: 'ReportsIndex' },
      })
      const view = oneElement(await page.default(), empty ? 'EmptyDashboards' : 'ReportsIndex')
      if (!empty) {
        expect(view.props).toMatchObject({ dashboards, homeId: 'report-a', canSetHome: true })
        expect(view.key).toBe('workspace-a')
      }
    })
  }
  it('report index identity changes with the workspace cookie without changing its data loader', async () => {
    const scope = { workspace: undefined as string | undefined }
    const read = vi.fn(async () => [{ id: 'report-a' }])
    const page = loadRoute('app/dashboards/page.tsx', {
      'next/headers': { cookies: async () => ({ get: () => scope.workspace ? { value: scope.workspace } : undefined }) },
      '@/lib/org/server': { ACTIVE_ORG_COOKIE: 'sample-active-org' },
      '@/utils/supabase/server': { createClient: async () => null },
      '@/lib/dashboards/home': { getHomeDashboardState: async () => { throw new Error('not reached without Supabase') } },
      '@/lib/org/require-role': { userHasOrgRole: async () => false },
      '@/lib/dashboards/fetch': { listDashboards: read, resolveActiveOrgId: async () => null },
      './EmptyDashboards': { EmptyDashboards: 'EmptyDashboards' }, './ReportsIndex': { ReportsIndex: 'ReportsIndex' },
    })
    expect(oneElement(await page.default(), 'ReportsIndex').key).toBe('default')
    scope.workspace = 'workspace-b'
    expect(oneElement(await page.default(), 'ReportsIndex').key).toBe('workspace-b')
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('actual empty report list delegates creation to the guarded shared controller', () => {
    const emptyModule = loadRoute('app/dashboards/EmptyDashboards.tsx', {
      './ReportsIndex': { ReportsIndex: 'ReportsIndex' },
    }) as unknown as { EmptyDashboards: (props: { actions: unknown }) => unknown }
    const actions = { create: vi.fn() }
    const view = oneElement(emptyModule.EmptyDashboards({ actions }), 'ReportsIndex')
    expect(view.props).toEqual({ dashboards: [], actions, emptyState: true })
    expect(actions.create).not.toHaveBeenCalled()
  })
  for (const found of [true, false]) {
    it(`configured report detail never substitutes a sample for a missing record (${found})`, async () => {
      const { client } = localClient(), detail = { id: 'report-a', widgets: [{ id: 'widget-a' }] }
      const read = vi.fn(async () => found ? detail : null)
      const page = loadRoute('app/dashboards/[slug]/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/dashboards/fetch': { getDashboardBySlug: read },
        '../DashboardHeader': { DashboardHeader: 'DashboardHeader' }, '../DashboardView': { DashboardView: 'DashboardView' },
      })
      const result = page.default({ params: Promise.resolve({ slug: 'sales' }) })
      if (!found) await expect(result).rejects.toThrow('NOT_FOUND')
      else {
        const tree = await result
        expect(oneElement(tree, 'DashboardHeader').props.dashboard).toBe(detail)
        expect(oneElement(tree, 'DashboardView').props).toEqual({ slug: 'sales', detail })
        expect(oneElement(oneElement(tree, 'DashboardHeader').props.children, 'DashboardView').props.detail).toBe(detail)
      }
      expect(read).toHaveBeenCalledExactlyOnceWith('sales')
    })
  }
  /** The workspace loader shared by the home dashboard and the report archive, with local IO. */
  function workspaceLoader(opts: { client: unknown; alerts: unknown[]; state: unknown; countRows: number; listIncidents: unknown; bootstrap?: unknown }) {
    return loadRoute('app/reports/workspace.ts', {
      'server-only': {}, '@/lib/org/timezone': { getOrgTimezone: async () => 'UTC' },
      '@/lib/activation/state': { getActivationState: async () => opts.state, countRows: async () => opts.countRows },
      '@/lib/activation/logic': activationLogic, '@/lib/activation/overview-stage': overviewStage,
      '@/lib/bootstrap/status': opts.bootstrap ?? { getBootstrapStatus: async () => ({ phases: { schema: 'done', context: 'done', kpi: 'done' }, counts: { tables: 4, entities: 2, rules: 3, kpis: 7 } }) },
      '@/lib/alerts/server': { listAlerts: async () => opts.alerts },
      '@/lib/alerts/health': health, '@/lib/alerts/evaluate': evaluation, '@/lib/alerts/incidents-server': { listIncidents: opts.listIncidents },
      '@/lib/supabase-oauth/errors': oauthErrors, '../monitors/presentation': monitorPresentation,
      '@/lib/plans/limits': { getPlanLimit: () => 300 }, '@/lib/dashboards/widget-source': widgetSource,
    }) as unknown as { loadWorkspace: (client: unknown, user: unknown, orgId: string, locale: string) => Promise<Record<string, unknown> & { reportInputs: Parameters<typeof reportsBuild.buildReports>[0] }> }
  }

  for (const checked of [false, true]) for (const firing of [false, true]) {
    it(`workspace derives each service's stage from enabled real-source monitors (${checked}/${firing})`, async () => {
      const { client, calls } = localClient({ organizations: [{ plan: 'sample-plan' }], organization_members: [{ role: 'owner' }], provider_connections: [],
        data_sources: [{ id: 'real', name: 'Production', is_demo: false }, { id: 'demo', name: 'Sample', is_demo: true }],
        kpi_extractions: [{ data_source_id: 'real', status: 'completed', created_at: '2026-09-16T00:00:00Z', completed_at: '2026-09-16T00:10:00Z', proposed_count: 7 }],
        data_source_context: [{ data_source_id: 'real', status: 'fresh', generated_at: '2026-09-16T00:00:00Z', source_repo_id: null }],
      })
      const incidentBase = { alertType: 'threshold', status: 'open', severity: 'high', value: 1, threshold: 10, operator: 'lt', changePct: -90, zScore: null, fireThreshold: 1, firedAt: new Date(Date.now() - 3_600_000).toISOString(), resolvedAt: null, resolvedValue: null, durationMs: 3_600_000, message: null, explanation: null, explained: false, notified: true, ack: null, feedback: null }
      const listIncidents = vi.fn(async () => ({ ackReady: true, incidents: [
        { ...incidentBase, id: 'event-real', alertId: 'real-a', alertName: 'Paid without access', dataSourceName: 'Production' },
        { ...incidentBase, id: 'event-demo', alertId: 'demo-a', alertName: 'Demo', dataSourceName: 'Sample' },
      ] }))
      // Deliberately NOT activated (no repo): an org watching real monitors is operating anyway.
      const state = activationLogic.computeActivation({ realActiveSources: 1, reposAttached: 0, contextsGenerated: 1, kpisProposed: 3, kpisAccepted: 1, monitorsEnabled: 2, slackConnected: false, alertChannelConfigured: false })
      const base = { enabled: true, status: 'normal', lastError: null, lastValue: 12, threshold: 10, type: 'threshold', operator: 'lt', lastCheckedAt: null, explanation: null, lastFiredAt: null, createdAt: '2026-09-01T00:00:00Z' }
      const alerts = [
        { ...base, id: 'real-a', name: 'Paid without access', dataSourceId: 'real', status: firing ? 'firing' : 'normal', lastCheckedAt: checked ? '2026-09-17T00:00:00Z' : null },
        { ...base, id: 'real-error', name: 'Failed check', dataSourceId: 'real', lastError: 'local error' },
        { ...base, id: 'demo-a', name: 'Demo', dataSourceId: 'demo', status: 'firing', createdAt: '2026-01-01T00:00:00Z' },
        { ...base, id: 'demo-pending', name: 'Demo awaiting evaluation', dataSourceId: 'demo' },
        { ...base, id: 'paused-a', name: 'Paused', dataSourceId: 'real', enabled: false },
      ]
      const ws = await workspaceLoader({ client, alerts, state, countRows: 7, listIncidents }).loadWorkspace(client, { id: 'user-a' }, 'org-a', 'en')
      expect(ws).toMatchObject({ orgId: 'org-a', canManage: true, isOrgAdmin: true, timeZone: 'UTC', ackReady: true, connectionPending: false })
      const services = ws.services as Record<string, unknown>[]
      // The demo source is never a service.
      expect(services.map(svc => svc.id)).toEqual(['real'])
      const svc = services[0]
      expect(svc).toMatchObject({
        stage: checked ? 'operating' : 'first_check', board: firing ? 'firing' : 'degraded', recovery: null,
        name: 'Production', repoAttached: false, monitorCount: 2, monitorTotal: 3, firingCount: firing ? 1 : 0, erroredCount: 1,
        pendingCount: 7, kpiHref: '/app/sources/real/kpis',
      })
      const rows = svc.monitors as { id: string; health: string }[]
      expect(rows.map(row => row.id)).not.toContain('demo-a')
      expect(rows).toHaveLength(3)
      expect(rows[0]).toMatchObject({ id: firing ? 'real-a' : 'real-error' })
      expect(svc.pendingCheckCount).toBe(!firing && !checked ? 1 : 0)
      expect(calls).toContainEqual(['kpi_catalog', 'eq', 'data_source_id', 'real'])

      // Reports: built from the incident history on REAL sources only, plus the service's own state;
      // monitoring starts with the first REAL monitor (the older demo monitor doesn't count).
      expect(ws.reportInputs.monitoringSince).toBe('2026-09-01T00:00:00Z')
      const reports = reportsBuild.buildReports(ws.reportInputs)
      expect(reports.some(r => r.id === 'incident:event-real')).toBe(true)
      expect(reports.some(r => r.id.includes('event-demo'))).toBe(false)
      expect(reports.find(r => r.kind === 'kpiReady')).toMatchObject({ needsAction: true })
      expect(reports.some(r => r.id === 'context:real:2026-09-16T00:00:00Z')).toBe(true)
      expect(listIncidents).toHaveBeenCalledExactlyOnceWith(client, 'org-a')
      expect(calls).toContainEqual(['kpi_extractions', 'eq', 'org_id', 'org-a'])
      expect(calls).toContainEqual(['data_source_context', 'eq', 'org_id', 'org-a'])
    })
  }

  for (const [search, view, focusId] of [
    [undefined, 'all', null],
    [{ view: 'all' }, 'all', null],
    [{ source: 'billing' }, 'single', 'billing'],
    [{ source: 'billing', view: 'all' }, 'all', null],
    [{ source: 'demo' }, 'all', null],
    [{ source: 'unknown' }, 'all', null],
  ] as const) {
    it(`report archive picks its view per service from the URL (${JSON.stringify(search)})`, async () => {
      const { client } = localClient({ organizations: [{ plan: 'sample-plan' }], organization_members: [{ role: 'viewer' }], provider_connections: [],
        data_sources: [{ id: 'real', name: 'Production', is_demo: false, provider: 'supabase', engine: 'postgres' }, { id: 'billing', name: 'Billing', is_demo: false, provider: 'direct', engine: 'mysql', repo_id: 'repo-a' }, { id: 'demo', name: 'Sample', is_demo: true }],
      })
      const state = activationLogic.computeActivation({ realActiveSources: 2, reposAttached: 1, contextsGenerated: 2, kpisProposed: 0, kpisAccepted: 0, monitorsEnabled: 1, slackConnected: false, alertChannelConfigured: false })
      const base = { enabled: true, status: 'normal', lastError: null, lastValue: 1, threshold: 0, type: 'threshold', operator: 'lt', lastCheckedAt: '2026-09-17T00:00:00Z', explanation: null, lastFiredAt: null, createdAt: '2026-09-01T00:00:00Z' }
      const alerts = [
        { ...base, id: 'billing-a', name: 'Refunds', dataSourceId: 'billing', status: 'firing' },
        { ...base, id: 'demo-a', name: 'Demo', dataSourceId: 'demo', status: 'firing' },
      ]
      const bootstrap = { getBootstrapStatus: vi.fn<(id: string) => Promise<unknown>>(async () => ({ phases: { schema: 'done', context: 'done', kpi: 'done' }, counts: { tables: 1, entities: 1, rules: 1, kpis: 0 } })) }
      const loader = workspaceLoader({ client, alerts, state, countRows: 0, listIncidents: async () => ({ ackReady: false, incidents: [] }), bootstrap })
      const page = loadRoute('app/reports/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' }, '@/lib/reports/build': reportsBuild,
        '@/components/analytics/TrackOnMount': { TrackOnMount: 'TrackOnMount' }, './ReportsView': { ReportsView: 'ReportsView' },
        './workspace': loader,
      })
      const props = oneElement(await page.default(search ? { searchParams: Promise.resolve(search) } : {}), 'ReportsView').props
      expect(props).toMatchObject({ view, focusId, canManage: false, orgId: 'org-a', ackReady: false })
      const services = props.services as Record<string, unknown>[]
      // Demo never becomes a service, and its firing monitor never lands on a real one.
      expect(services.map(svc => svc.id)).toEqual(['real', 'billing'])
      expect(services[0]).toMatchObject({ engine: 'supabase', stage: 'extract', firingCount: 0, monitors: [] })
      expect(services[1]).toMatchObject({ engine: 'mysql', repoAttached: true, stage: 'operating', board: 'firing', firingCount: 1 })
      expect(String(services[1].reconnectHref)).toContain(encodeURIComponent('/app/overview'))
      expect(bootstrap.getBootstrapStatus.mock.calls.map(call => call[0])).toEqual(['real', 'billing'])
      // The single view scopes the reports to its service; the all view reports on every service.
      const reports = props.reports as { service: { id: string } | null }[]
      if (focusId) expect(reports.every(r => r.service === null || r.service.id === focusId)).toBe(true)
      else expect(reports.some(r => r.service?.id === 'real')).toBe(true) // its "get KPI proposals" report
    })
  }

  /* ---------------- home dashboard ---------------- */
  const HOME = { id: 'd-core', slug: 'core-kpi', name: 'Core KPIs', pinned: true, position: 0 }
  const OTHER = { id: 'd-growth', slug: 'growth', name: 'Growth', pinned: false, position: 1 }
  function overviewPage(opts: { board?: { widgets: unknown[] } | null; pending?: number; boards?: typeof HOME[]; home?: typeof HOME | null; admin?: boolean; settable?: boolean }) {
    const { client, calls } = localClient({ kpi_catalog: [{ id: 'k1', title: 'Daily revenue', importance: 5, data_source_id: 'real' }] })
    const service = { id: 'real', name: 'Production', pendingCount: opts.pending ?? 0, stage: 'proposals' }
    const ws = {
      orgId: 'org-a', canManage: true, isOrgAdmin: opts.admin ?? true, services: [service], connectionPending: false, intervalMin: 5,
      timeZone: 'UTC', now: Date.parse('2026-09-17T03:00:00Z'), ackReady: true, kpisAccepted: 0,
      reportInputs: { now: Date.parse('2026-09-17T03:00:00Z'), timeZone: 'UTC', services: [], incidents: [], extractions: [], contexts: [], monitoringSince: null },
    }
    const getDashboardBySlug = vi.fn(async (slug: string) => opts.board === null ? null : { ...(slug === OTHER.slug ? OTHER : HOME), widgets: opts.board?.widgets ?? [] })
    const home = opts.home === undefined ? HOME : opts.home
    const getHomeDashboardState = vi.fn(async () => ({ dashboards: opts.boards ?? [HOME, OTHER], home, chosen: false, reason: home ? 'core' : null, auto: home, settable: opts.settable ?? true }))
    const page = loadRoute('app/overview/page.tsx', {
      ...common, '@/utils/supabase/server': { createClient: async () => client },
      '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' },
      '@/lib/dashboards/fetch': { getDashboardBySlug }, '@/lib/dashboards/home': { getHomeDashboardState },
      '@/lib/reports/build': reportsBuild, '../reports/workspace': { loadWorkspace: async () => ws },
      '@/components/analytics/TrackOnMount': { TrackOnMount: 'TrackOnMount' }, './OverviewView': { OverviewView: 'OverviewView' },
    })
    return { page, calls, getDashboardBySlug, getHomeDashboardState, client }
  }

  it('overview always shows the home dashboard and passes why it is home', async () => {
    const { page, getDashboardBySlug, getHomeDashboardState, client } = overviewPage({ board: { widgets: [{ id: 'w1' }] } })
    const props = oneElement(await page.default(), 'OverviewView').props
    expect(getHomeDashboardState).toHaveBeenCalledExactlyOnceWith(client, 'org-a')
    expect(getDashboardBySlug).toHaveBeenCalledExactlyOnceWith('core-kpi')
    expect(props).toMatchObject({ canManage: true, canSetHome: true, home: HOME, homeReason: 'core', autoHome: HOME, boards: [HOME, OTHER], proposals: [] })
    expect((props.board as { slug: string }).slug).toBe('core-kpi')
  })

  it('overview previews proposals only when the home board has no widgets and proposals wait', async () => {
    const withWidgets = overviewPage({ board: { widgets: [{ id: 'w1' }] }, pending: 3 })
    expect(oneElement(await withWidgets.page.default({}), 'OverviewView').props.proposals).toEqual([])
    expect(withWidgets.calls.some(call => call[0] === 'kpi_catalog')).toBe(false)

    const empty = overviewPage({ board: null, home: null, boards: [], pending: 3 })
    const props = oneElement(await empty.page.default({}), 'OverviewView').props
    expect(props.board).toBeNull()
    expect(props.proposals).toEqual([{ id: 'k1', title: 'Daily revenue', importance: 5, dataSourceId: 'real' }])
    expect(empty.calls).toContainEqual(['kpi_catalog', 'eq', 'status', 'proposed'])
  })

  it('only owners and admins may set the home, and only once the column exists', async () => {
    for (const [admin, settable, expected] of [[true, true, true], [false, true, false], [true, false, false]] as const) {
      const { page } = overviewPage({ board: { widgets: [] }, admin, settable })
      expect(oneElement(await page.default({}), 'OverviewView').props.canSetHome).toBe(expected)
    }
  })
})
