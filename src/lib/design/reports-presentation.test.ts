import { describe, expect, it } from 'vitest'
import { serviceStage, type OverviewStageInputs } from '@/lib/activation/overview-stage'
import * as incidents from '@/lib/alerts/incidents'
import type { Report } from '@/lib/reports/build'
import type { ReportsViewProps } from '@/app/app/reports/ReportsView'
import type { OverviewService } from '@/app/app/reports/workspace'
import { elements, type RouteElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

const t = (key: string, values?: Record<string, unknown>) => `${key}${values ? `:${JSON.stringify(values)}` : ''}`
const icons = new Proxy({}, { get: (_, name) => String(name) })
const { ReportsView } = loadRoute('app/reports/ReportsView.tsx', {
  'next/link': 'Link', 'next-intl/server': { getTranslations: async () => t },
  'lucide-react': icons, '@/components/brand/DatabaseLogo': 'DatabaseLogo', '@/lib/alerts/incidents': incidents,
  './ServiceSwitcher': { ServiceSwitcher: 'ServiceSwitcher' }, './ReportFeed': { ReportFeed: 'ReportFeed' },
  './board.module.css': { value: 'value', service: 'service', railService: 'railService', serviceAlert: 'serviceAlert', railFigures: 'railFigures', reportsEmpty: 'reportsEmpty' },
}) as unknown as { ReportsView: (props: ReportsViewProps) => Promise<unknown> }

type StageInputs = Omit<OverviewStageInputs, 'realSources' | 'connectionPending'>
const stageBase: StageInputs = {
  scan: { context: 'done', kpi: 'done' }, pendingProposals: 0,
  monitorsTotal: 0, monitorsEnabled: 0, monitorsChecked: 0, firing: 0, errored: 0, connectionErrors: 0,
}
const serviceBase: Omit<OverviewService, 'stage' | 'board' | 'recovery'> = {
  id: 'source-a', name: 'Local sample', engine: 'supabase', repoAttached: false,
  reconnectHref: '/api/connect-supabase/authorize?returnTo=%2Fapp%2Foverview%3Fsource%3Dsource-a',
  monitorCount: 0, monitorTotal: 0, firingCount: 0, erroredCount: 0, pendingCheckCount: 0, brokenCount: 0,
  checkedAgo: null, nextMin: 5, kpiHref: '/app/sources/source-a/kpis', monitors: [], pendingCount: 0,
}
const service = (stage: Partial<StageInputs>, over: Partial<OverviewService> = {}): OverviewService =>
  ({ ...serviceBase, ...over, ...serviceStage({ ...stageBase, ...stage }) })

const report = (over: Partial<Report> = {}): Report => ({
  id: 'incident:event-a', type: 'urgent', kind: 'incident', importance: 'critical', needsAction: true, at: '2026-09-17T01:00:00.000Z',
  live: false, service: { id: 'source-a', name: 'Local sample' }, params: {}, tags: [], href: '/app/incidents/event-a', ...over,
})

const props = (over: Partial<ReportsViewProps>): ReportsViewProps => ({
  view: 'single', focusId: null, services: [], canManage: true, intervalMin: 5,
  reports: [], now: Date.parse('2026-09-17T03:00:00Z'), timeZone: 'Asia/Seoul', orgId: 'org-a', ackReady: true, ...over,
})
const text = (element: RouteElement) => JSON.stringify(element.props.children)
const lede = (tree: unknown) => elements(tree, 'p').find(node => node.props.className === 'dx-sub')?.props.children
const hrefs = (tree: unknown) => elements(tree, 'Link').map(node => String(node.props.href))

describe('actual Reports: nothing connected', () => {
  it('says there is nothing to report yet and points at connecting data — no feed', async () => {
    const tree = await ReportsView(props({}))
    const empty = elements(tree, 'section').find(node => node.props.className === 'reportsEmpty')!
    expect(text(empty)).toContain('reports.page.empty')
    expect(hrefs(empty)).toEqual(['/app/sources'])
    expect(elements(tree, 'ReportFeed')).toHaveLength(0)
    expect(elements(tree, 'ServiceSwitcher')).toHaveLength(0)
  })
})

describe('actual Reports: the report archive', () => {
  const firing = service({ monitorsTotal: 2, monitorsEnabled: 2, monitorsChecked: 2, firing: 1 }, { id: 'svc-firing', name: 'Production', monitorCount: 2, monitorTotal: 2, firingCount: 1, checkedAgo: 3 })
  const broken = service({ monitorsTotal: 2, monitorsEnabled: 2, monitorsChecked: 2, errored: 2, connectionErrors: 2 }, { id: 'svc-broken', name: 'Billing', monitorCount: 2, monitorTotal: 2, erroredCount: 2, brokenCount: 2, checkedAgo: 3, reconnectHref: '/api/connect-supabase/authorize?returnTo=%2Fapp%2Foverview%3Fsource%3Dsvc-broken' })
  const proposals = service({ pendingProposals: 5 }, { id: 'svc-proposals', name: 'Analytics', pendingCount: 5, kpiHref: '/app/sources/svc-proposals/kpis' })

  it('the feed receives the reports and the clock they were built with; the lede counts open decisions', async () => {
    const reports = [report(), report({ id: 'daily:org:2026-09-17', type: 'daily', kind: 'daily', importance: 'low', needsAction: false })]
    const tree = await ReportsView(props({ view: 'all', services: [firing, proposals], reports }))
    const feed = elements(tree, 'ReportFeed')
    expect(feed).toHaveLength(1)
    expect(feed[0].props).toMatchObject({ reports, orgId: 'org-a', timeZone: 'Asia/Seoul', now: Date.parse('2026-09-17T03:00:00Z'), canManage: true, ackReady: true })
    expect(lede(tree)).toBe('reports.lede:{"total":2,"action":1}')
  })

  it('all view: the rail lists every service with its stage, each opening its own reports', async () => {
    const services = [firing, broken, proposals]
    const tree = await ReportsView(props({ view: 'all', services }))
    const rows = elements(tree, 'Link').filter(node => node.props.className === 'railService')
    expect(rows.map(row => row.props.href)).toEqual(services.map(svc => `/app/reports?source=${svc.id}`))
    expect(rows.map(row => row.props['data-stage'])).toEqual(services.map(svc => svc.stage))
    // No service card in the all view — the feed carries the detail.
    expect(elements(tree, 'article').filter(node => node.props.className === 'service')).toHaveLength(0)
  })

  it('single view: the rail shows that service in full, with its recovery action', async () => {
    const tree = await ReportsView(props({ view: 'single', focusId: broken.id, services: [firing, broken], reports: [report({ service: { id: broken.id, name: broken.name } })] }))
    const cards = elements(tree, 'article').filter(node => node.props.className === 'service')
    expect(cards).toHaveLength(1)
    expect(cards[0].props['aria-labelledby']).toBe(`service-${broken.id}`)
    expect(text(elements(cards[0], 'p').find(node => node.props.role === 'alert')!)).toContain('home.recovery.reconnect')
    expect(elements(cards[0], 'Link').map(node => node.props.href)).toContain(broken.reconnectHref)
    expect(lede(tree)).toBe('reports.ledeScoped:{"service":"Billing","total":1,"action":1}')
  })

  it('viewers see the recovery state but not the reconnect action', async () => {
    const tree = await ReportsView(props({ view: 'single', focusId: broken.id, services: [broken], canManage: false }))
    expect(hrefs(tree).some(href => href.startsWith('/api/connect-supabase'))).toBe(false)
    expect(JSON.stringify(tree)).toContain('home.recovery.reconnect')
    expect(elements(tree, 'ReportFeed')[0].props.canManage).toBe(false)
  })

  it('the last-7-days figures sum the daily reports', async () => {
    const daily = (key: string, fired: number, resolved: number, mttrMs: number | null) =>
      report({ id: `daily:org:${key}`, type: 'daily', kind: 'daily', needsAction: false, totals: { fired, resolved, open: 0, mttrMs } })
    const tree = await ReportsView(props({ view: 'all', services: [firing, proposals], reports: [daily('a', 2, 1, 60 * 60_000), daily('b', 1, 1, 3 * 60 * 60_000)] }))
    const figures = elements(tree, 'dl').find(node => node.props.className === 'railFigures')!
    const values = elements(figures, 'dd').map(node => node.props.children)
    expect(values.slice(0, 2)).toEqual([3, 2])
    expect(values[2]).toBe('duration.hours:{"n":2}')
  })

  it('switcher: offered with two or more services, marking the current view', async () => {
    const all = await ReportsView(props({ view: 'all', services: [firing, proposals] }))
    const switcher = elements(all, 'ServiceSwitcher')
    expect(switcher).toHaveLength(1)
    expect(switcher[0].props.all).toMatchObject({ href: '/app/reports?view=all', current: true })

    const single = await ReportsView(props({ view: 'single', focusId: proposals.id, services: [firing, proposals] }))
    const items = elements(single, 'ServiceSwitcher')[0].props.services as { key: string; current: boolean }[]
    expect(items.map(item => [item.key, item.current])).toEqual([[firing.id, false], [proposals.id, true]])

    const one = await ReportsView(props({ view: 'single', focusId: firing.id, services: [firing] }))
    expect(elements(one, 'ServiceSwitcher')).toHaveLength(0)
  })

  for (const health of ['paused', 'error', 'pending', 'healthy', 'incident'] as const) {
    it(`${health}: only evaluated active readings occupy a service card's value cell`, async () => {
      const svc = service({ monitorsTotal: 1, monitorsEnabled: 1, monitorsChecked: 1 }, {
        monitorCount: 1, monitorTotal: 1, checkedAgo: 3, monitors: [{ id: 'sample-a', name: 'Sample monitor', health, value: '1,234.56', expected: '≥ 10', agoMin: 5 }],
      })
      const tree = await ReportsView(props({ view: 'single', focusId: svc.id, services: [svc] }))
      const row = elements(tree, 'li').find(node => node.props['data-state'] === health)!
      expect(elements(row, 'Link')[0].props.href).toBe('/app/monitors/sample-a')
      const value = elements(row, 'span').find(node => node.props.className === 'value')
      expect(value?.props.children).toBe(['paused', 'error', 'pending'].includes(health) ? '—' : '1,234.56')
    })
  }
})
