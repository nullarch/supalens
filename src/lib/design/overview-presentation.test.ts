import { describe, expect, it } from 'vitest'
import { showChecklist } from '@/lib/activation/checklist'
import { computeActivation, type ActivationInputs } from '@/lib/activation/logic'
import { serviceStage, type OverviewStageInputs } from '@/lib/activation/overview-stage'
import type { DashboardDetail, DashboardSummary } from '@/lib/dashboards/types'
import type { OverviewViewProps } from '@/app/app/overview/OverviewView'
import type { OverviewService } from '@/app/app/reports/workspace'
import { elements, type RouteElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

const t = (key: string, values?: Record<string, unknown>) => `${key}${values ? `:${JSON.stringify(values)}` : ''}`
const icons = new Proxy({}, { get: (_, name) => String(name) })
const { OverviewView } = loadRoute('app/overview/OverviewView.tsx', {
  'next/link': 'Link', 'next-intl/server': { getTranslations: async () => t },
  'lucide-react': icons, '@/components/brand/DatabaseLogo': 'DatabaseLogo',
  '../dashboards/DashboardView': { DashboardView: 'DashboardView' },
  './BoardControls': { BoardControls: 'BoardControls' }, './DraftBoardButton': { DraftBoardButton: 'DraftBoardButton' },
  './SetupChecklist': { SetupChecklist: 'SetupChecklist' }, '@/lib/activation/checklist': { showChecklist },
  './overview.module.css': { meta: 'meta', emptyHome: 'emptyHome', proposalRow: 'proposalRow', analyzingRow: 'analyzingRow' },
}) as unknown as { OverviewView: (props: OverviewViewProps) => Promise<unknown> }

type StageInputs = Omit<OverviewStageInputs, 'realSources' | 'connectionPending'>
const stageBase: StageInputs = {
  scan: { context: 'done', kpi: 'done' }, pendingProposals: 0,
  monitorsTotal: 0, monitorsEnabled: 0, monitorsChecked: 0, firing: 0, errored: 0, connectionErrors: 0,
}
const service = (stage: Partial<StageInputs>, over: Partial<OverviewService> = {}): OverviewService => ({
  id: 'source-a', name: 'Production', engine: 'supabase', repoAttached: false, reconnectHref: '/api/connect-supabase/authorize',
  monitorCount: 0, monitorTotal: 0, firingCount: 0, erroredCount: 0, pendingCheckCount: 0, brokenCount: 0,
  checkedAgo: null, nextMin: 5, kpiHref: '/app/sources/source-a/kpis', monitors: [], pendingCount: 0,
  ...over, ...serviceStage({ ...stageBase, ...stage }),
})
const operating = service({ monitorsTotal: 2, monitorsEnabled: 2, monitorsChecked: 2 }, { monitorCount: 2, monitorTotal: 2, checkedAgo: 3 })

const HOME: DashboardSummary = { id: 'd-core', slug: 'core-kpi', name: 'Core KPIs', pinned: true, position: 0 }
const OTHER: DashboardSummary = { id: 'd-growth', slug: 'growth', name: 'Growth', pinned: false, position: 1 }
const detail = (summary: DashboardSummary, widgets = 2): DashboardDetail => ({
  ...summary,
  widgets: Array.from({ length: widgets }, (_, i) => ({ id: `w${i}`, spec: { type: 'kpi', title: `KPI ${i}`, value: 'v' } as never, sample: null, layout: { x: 0, y: 0, w: 6, h: 3 }, position: i, dataSourceId: null, savedQueryId: null, refreshInterval: null })),
})

const activation = (over: Partial<ActivationInputs> = {}) => computeActivation({
  realActiveSources: 1, reposAttached: 0, contextsGenerated: 0, kpisProposed: 0, kpisAccepted: 0,
  monitorsEnabled: 0, slackConnected: false, alertChannelConfigured: false, ...over,
})
const ACTIVATED = activation({ reposAttached: 1, contextsGenerated: 1, kpisProposed: 9, kpisAccepted: 5, monitorsEnabled: 3, alertChannelConfigured: true })

const props = (over: Partial<OverviewViewProps>): OverviewViewProps => ({
  orgId: 'org-a', activation: ACTIVATED,
  services: [], canManage: true, canSetHome: true, connectionPending: false,
  boards: [], home: null, homeReason: null, autoHome: null, board: null, proposals: [], ...over,
})
const text = (element: RouteElement) => JSON.stringify(element.props.children)
const lede = (tree: unknown) => elements(tree, 'p').find(node => node.props.className === 'dx-sub')?.props.children
const emptyCard = (tree: unknown) => elements(tree, 'section').find(node => node.props.className === 'emptyHome')
const hrefs = (tree: unknown) => elements(tree, 'Link').map(node => String(node.props.href))

describe('actual Overview: an org with nothing connected', () => {
  for (const [name, view, state, key] of [
    ['new', {}, 'new', 'home.banner.new'],
    ['connection pending', { connectionPending: true }, 'pending_connection', 'home.banner.pending'],
  ] as const) {
    it(`${name}: the onboarding strip and no board`, async () => {
      const tree = await OverviewView(props(view))
      const meta = elements(tree, 'div').find(node => node.props.className === 'meta')!
      expect(meta.props['data-state']).toBe(state)
      expect(text(meta)).toContain(key)
      expect(elements(tree, 'DashboardView')).toHaveLength(0)
    })
  }
})

describe('actual Overview: the home dashboard', () => {
  it('renders the home board live, with the "show on Overview" picker in the title row', async () => {
    const tree = await OverviewView(props({ services: [operating], boards: [HOME, OTHER], home: HOME, homeReason: 'core', autoHome: HOME, board: detail(HOME) }))
    const board = elements(tree, 'DashboardView')
    expect(board).toHaveLength(1)
    expect(board[0].props).toMatchObject({ slug: 'core-kpi', detail: detail(HOME) })
    const controls = elements(tree, 'BoardControls')[0].props
    expect(controls).toMatchObject({
      boards: [{ id: 'd-core', name: 'Core KPIs' }, { id: 'd-growth', name: 'Growth' }],
      chosenId: null, openSlug: 'core-kpi', canSetHome: true,
    })
    expect((controls.labels as { auto: string }).auto).toBe('home.board.auto:{"name":"Core KPIs"}')
    // the lede says WHY this board is on the Overview
    expect(lede(tree)).toBe('home.board.reason.core:{"name":"Core KPIs"}')
    expect(emptyCard(tree)).toBeUndefined()
  })

  it('a chosen board is named as chosen, and the picker holds it (Automatic still names the rule\'s board)', async () => {
    const tree = await OverviewView(props({ services: [operating], boards: [HOME, OTHER], home: OTHER, homeReason: 'chosen', autoHome: HOME, board: detail(OTHER), canSetHome: false }))
    expect(lede(tree)).toBe('home.board.reason.chosen:{"name":"Growth"}')
    const controls = elements(tree, 'BoardControls')[0].props
    expect(controls).toMatchObject({ chosenId: 'd-growth', openSlug: 'growth', canSetHome: false })
    expect((controls.labels as { auto: string }).auto).toBe('home.board.auto:{"name":"Core KPIs"}')
  })

  for (const reason of ['pinned', 'first'] as const) {
    it(`an automatic ${reason} home says which rule picked it`, async () => {
      const tree = await OverviewView(props({ services: [operating], boards: [OTHER], home: OTHER, homeReason: reason, autoHome: OTHER, board: detail(OTHER) }))
      expect(lede(tree)).toBe(`home.board.reason.${reason}:{"name":"Growth"}`)
    })
  }

  it('a ready draft: previews the most important proposals of that source and offers to build it', async () => {
    const drafting = service({ pendingProposals: 9 }, { id: 'svc-b', name: 'Billing', pendingCount: 9, kpiHref: '/app/sources/svc-b/kpis' })
    const other = service({ pendingProposals: 2 }, { id: 'svc-c', name: 'Events', pendingCount: 2 })
    const proposals = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, title: `Billing KPI ${i}`, importance: 5 - Math.floor(i / 2), dataSourceId: 'svc-b' })),
      { id: 'c0', title: 'Events KPI', importance: 5, dataSourceId: 'svc-c' },
    ]
    const tree = await OverviewView(props({ services: [other, drafting], proposals }))
    const card = emptyCard(tree)!
    expect(card.props['data-state']).toBe('draft')
    const rows = elements(card, 'li').filter(node => node.props.className === 'proposalRow')
    expect(rows).toHaveLength(6)
    expect(JSON.stringify(rows)).not.toContain('Events KPI')
    expect(elements(card, 'DraftBoardButton')[0].props.dataSourceId).toBe('svc-b')
    expect(hrefs(card)).toContain('/app/sources/svc-b/kpis')
    expect(elements(tree, 'DashboardView')).toHaveLength(0)
  })

  it('viewers see the draft but cannot build it', async () => {
    const drafting = service({ pendingProposals: 3 }, { pendingCount: 3 })
    const tree = await OverviewView(props({ services: [drafting], canManage: false, proposals: [{ id: 'k', title: 'KPI', importance: 4, dataSourceId: 'source-a' }] }))
    expect(elements(tree, 'DraftBoardButton')).toHaveLength(0)
    expect(JSON.stringify(emptyCard(tree))).toContain('home.empty.viewerNote')
  })

  it('analyzing: says the AI is building the dashboard and lists the sources it is reading', async () => {
    const reading = service({ scan: { context: 'running', kpi: 'pending' } }, { id: 'svc-a', name: 'Production' })
    const tree = await OverviewView(props({ services: [reading, operating] }))
    const card = emptyCard(tree)!
    expect(card.props['data-state']).toBe('analyzing')
    expect(elements(card, 'li').filter(node => node.props.className === 'analyzingRow')).toHaveLength(1)
  })

  it('no proposals yet: points at getting KPI proposals (managers only)', async () => {
    const extract = service({}, { id: 'svc-x', name: 'Warehouse', kpiHref: '/app/sources/svc-x/kpis' })
    const manager = await OverviewView(props({ services: [extract] }))
    expect(emptyCard(manager)!.props['data-state']).toBe('extract')
    expect(hrefs(emptyCard(manager))).toEqual(['/app/sources/svc-x/kpis'])
    const viewer = await OverviewView(props({ services: [extract], canManage: false }))
    expect(hrefs(emptyCard(viewer))).toEqual([])
  })

  it('an activated workspace gets NO onboarding checklist anywhere', async () => {
    const tree = await OverviewView(props({ services: [operating], boards: [HOME], home: HOME, board: detail(HOME) }))
    expect(elements(tree, 'SetupChecklist')).toHaveLength(0)
    expect(elements(await OverviewView(props({ services: [], activation: ACTIVATED })), 'SetupChecklist')).toHaveLength(0)
  })

  it('an empty home board keeps its controls and offers to add a chart', async () => {
    const tree = await OverviewView(props({ services: [operating], boards: [HOME], home: HOME, board: detail(HOME, 0) }))
    expect(emptyCard(tree)!.props['data-state']).toBe('empty')
    expect(hrefs(emptyCard(tree))).toEqual(['/app/ask', '/app/dashboards'])
    expect(elements(tree, 'BoardControls')).toHaveLength(1)
    expect(elements(tree, 'DashboardView')).toHaveLength(0)
  })
})

describe('actual Overview: the single onboarding checklist', () => {
  const half = activation({ contextsGenerated: 1, kpisProposed: 6, kpisAccepted: 1 })

  it('rides above the board on the home view, and is the only guide there', async () => {
    const tree = await OverviewView(props({ services: [operating], activation: half, boards: [HOME], home: HOME, board: detail(HOME) }))
    const checklist = elements(tree, 'SetupChecklist')
    expect(checklist).toHaveLength(1)
    expect(checklist[0].props).toMatchObject({ orgId: 'org-a', activation: half, sourceId: 'source-a', kpiHref: '/app/sources/source-a/kpis', canManage: true })
    // the board still renders — the checklist never replaces or blocks the page
    expect(elements(tree, 'DashboardView')).toHaveLength(1)
  })

  it('an unconnected workspace gets the same one checklist (no source to act on yet)', async () => {
    const fresh = activation({ realActiveSources: 0 })
    const tree = await OverviewView(props({ services: [], activation: fresh }))
    expect(elements(tree, 'SetupChecklist')[0].props).toMatchObject({ activation: fresh, sourceId: null, kpiHref: null })
  })

  it('an unreadable activation state renders no checklist rather than a guessed one', async () => {
    expect(elements(await OverviewView(props({ services: [operating], activation: null })), 'SetupChecklist')).toHaveLength(0)
  })

  it('viewers see the checklist read-only', async () => {
    const tree = await OverviewView(props({ services: [operating], activation: half, canManage: false }))
    expect(elements(tree, 'SetupChecklist')[0].props.canManage).toBe(false)
  })
})
