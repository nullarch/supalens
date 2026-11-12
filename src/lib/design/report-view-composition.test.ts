import { describe, expect, it, vi } from 'vitest'
import { VisualizationSpec } from '@/lib/viz/spec'
import { elements, oneElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

function fixture() {
  const read = vi.fn(async () => null)
  const isAdmin = vi.fn(async () => true)
  const actions = { saveDashboardLayout: vi.fn(), removeWidget: vi.fn(), updateWidget: vi.fn() }
  const samples = [{ id: 'local-sample' }]
  const translate = Object.assign((key: string) => key, { raw: () => ['A', 'B', 'C', 'D'] })
  const reportModule = loadRoute('app/dashboards/DashboardView.tsx', {
    'next/link': 'Link', 'next-intl/server': { getTranslations: async () => translate },
    './overview.module.css': { sampleBadge: 'sample-badge' },
    '@/components/dashboard/widgets': { DashboardGrid: 'DashboardGrid' }, './EmptyReport': { EmptyReport: 'EmptyReport' },
    '@/lib/dashboards/fetch': { getDashboardBySlug: read }, '@/lib/auth/is-admin': { isCurrentUserAdmin: isAdmin },
    '@/lib/dashboards/actions': actions, '@/lib/dashboards/sample': { SAMPLE_OVERVIEW_WIDGETS: samples },
    '@/lib/viz/spec': { VisualizationSpec },
  }) as unknown as { DashboardView: (props: { slug: string; detail?: unknown }) => Promise<unknown> }
  return { ...reportModule, read, isAdmin, actions, samples }
}

describe('actual report composition without database or mutations', () => {
  it('renders the actual empty report and never a sample for an empty real board', async () => {
    const f = fixture()
    const tree = await f.DashboardView({ slug: 'sales', detail: { id: 'board-a', widgets: [] } })
    expect(elements(tree, 'EmptyReport')).toHaveLength(1)
    expect(elements(tree, 'DashboardGrid')).toHaveLength(0)
    expect(f.read).not.toHaveBeenCalled()
    for (const action of Object.values(f.actions)) expect(action).not.toHaveBeenCalled()
    expect(oneElement(tree, 'Link').props.href).toBe('/app/ask')
  })
  it('preserves populated fields, report identity and action wiring without executing actions', async () => {
    const f = fixture()
    const widget = { id: 'widget-a', spec: { type: 'bignumber', title: 'Revenue', value: 'value' },
      sample: { columns: ['value'], rows: [{ value: 7 }] }, layout: { w: 6, h: 4 },
      liveError: true, monitor: { alertId: 'monitor-a' }, definition: { key: 'metric-a' }, refreshInterval: 60 }
    const tree = await f.DashboardView({ slug: 'sales', detail: { id: 'board-a', widgets: [widget] } })
    const grid = oneElement(tree, 'DashboardGrid')
    expect(grid.key).toBe('board-a')
    expect(grid.props.widgets).toEqual([{ id: widget.id, spec: widget.spec, data: widget.sample, w: 6, h: 4, error: true, monitor: widget.monitor, definition: widget.definition }])
    expect(grid.props.initialLayout).toEqual({ order: ['widget-a'], sizes: { 'widget-a': { w: 6, h: 4 } } })
    expect(grid.props.editMeta).toEqual({ 'widget-a': { title: 'Revenue', sql: null, refreshInterval: 60 } })
    expect(grid.props.onPersist).toBe(f.actions.saveDashboardLayout)
    expect(grid.props.onRemoveWidget).toBe(f.actions.removeWidget)
    expect(grid.props.onUpdateWidget).toBe(f.actions.updateWidget)
    expect(grid.props.isAdmin).toBe(true)
    expect(elements(tree, 'EmptyReport')).toHaveLength(0)
    for (const action of Object.values(f.actions)) expect(action).not.toHaveBeenCalled()
  })
  it('keeps sample mode local and reads the original slug only when detail was not supplied', async () => {
    const f = fixture()
    const grid = oneElement(await f.DashboardView({ slug: 'sample' }), 'DashboardGrid')
    expect(f.read).toHaveBeenCalledExactlyOnceWith('sample')
    expect(grid.props.widgets).toBe(f.samples)
    expect(grid.props.onPersist).toBeUndefined()
    expect(grid.props.onRemoveWidget).toBeUndefined()
    expect(grid.props.onUpdateWidget).toBeUndefined()
    expect(grid.key).toBe('sample')
  })
})
