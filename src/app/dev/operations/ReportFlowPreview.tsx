'use client'

import { useEffect, useRef, useState } from 'react'
import { AddToDashboard, type SaveToReportActions } from '@/components/agent/AddToDashboard'
import { ReportsIndex, type ReportListActions } from '@/app/app/dashboards/ReportsIndex'
import { EmptyDashboards } from '@/app/app/dashboards/EmptyDashboards'
import type { ActionResult, DashboardSummary } from '@/lib/dashboards/types'
import s from './operations-preview.module.css'

const initial: DashboardSummary[] = [
  { id: 'fixture-core', slug: 'fixture-core', name: 'Business health', pinned: true, position: 0 },
  { id: 'fixture-long', slug: 'fixture-long', name: `InternationalSubscriptionEntitlementReconciliation_${'Sample'.repeat(14)}`, pinned: false, position: 1 },
]

/** Every operation is local. No real server action, account mutation or query. */
export function ReportFlowPreview({ view, mode }: { view: 'save' | 'report-actions'; mode: string }) {
  const [rows, setRows] = useState(mode === 'empty' ? [] : initial)
  const [calls, setCalls] = useState<string[]>([])
  const [navigation, setNavigation] = useState('No navigation')
  const [refreshes, setRefreshes] = useState(0)
  const [responseShape, setResponseShape] = useState('normal')
  const [source, setSource] = useState('fixture-source')
  const [visualization, setVisualization] = useState(1)
  const [ready, setReady] = useState(false)
  const [workspace, setWorkspace] = useState('fixture-workspace')
  const workspaceRef = useRef(workspace)
  useEffect(() => setReady(true), [])
  const recovered = useRef(false)
  const addCount = useRef(0)
  const createCount = useRef(0)
  async function call(label: string) {
    setCalls(previous => [...previous, label])
    await new Promise(resolve => setTimeout(resolve, 650))
    if ((mode === 'throw' || responseShape === 'throw') && !recovered.current) throw new Error('Sample transport failure')
    if (!recovered.current && ((mode === 'add-throw' && label.startsWith('add:')) || (mode === 'create-throw' && label.startsWith('create:')))) throw new Error('Sample write response lost')
  }
  function failure() {
    if (recovered.current) return null
    if (mode === 'unconfigured') return { ok: false as const, reason: 'unconfigured' as const }
    if (mode === 'failure' || responseShape === 'failure') return { ok: false as const, reason: 'error' as const, message: 'Sample permission failure. No confirmed change.' }
    return null
  }
  const create: ReportListActions['create'] = async name => {
    createCount.current++
    await call(`create:${createCount.current}`)
    const failed = failure()
    if (failed) return failed
    if (responseShape === 'create-malformed') return { ok: true, data: { id: '', slug: '../invalid' } }
    if (mode === 'create-failure' && !recovered.current) return { ok: false, reason: 'error' }
    if (responseShape === 'malformed') return { ok: true, data: { id: '', slug: '../invalid' } }
    const row = { id: `fixture-created-${createCount.current}`, slug: `fixture-created-${createCount.current}`, name, pinned: false, position: rows.length }
    if (workspaceRef.current === workspace) setRows(previous => [...previous, row])
    return { ok: true, data: { id: row.id, slug: row.slug } }
  }
  const listActions: ReportListActions = {
    create,
    pin: async (id, pinned) => { await call(`pin:${id}`); const failed = failure(); if (failed) return failed; if (responseShape === 'malformed') return { ok: 'yes' } as unknown as ActionResult; if (workspaceRef.current === workspace) setRows(previous => previous.map(row => row.id === id ? { ...row, pinned } : row)); return { ok: true, data: undefined } },
    rename: async (id, name) => { await call(`rename:${id}`); const failed = failure(); if (failed) return failed; if (responseShape === 'malformed') return { ok: 'yes' } as unknown as ActionResult; if (workspaceRef.current === workspace) setRows(previous => previous.map(row => row.id === id ? { ...row, name } : row)); return { ok: true, data: undefined } },
    remove: async id => { await call(`delete:${id}`); const failed = failure(); if (failed) return failed; if (responseShape === 'malformed') return { ok: 'yes' } as unknown as ActionResult; if (workspaceRef.current === workspace) setRows(previous => previous.filter(row => row.id !== id)); return { ok: true, data: undefined } },
    navigate: href => { if (responseShape === 'navigate-error') throw new Error('Sample navigation failed'); setNavigation(href) },
    refresh: () => { if (responseShape === 'refresh-error') throw new Error('Sample refresh failed'); setRefreshes(previous => previous + 1) },
  }
  const saveActions: SaveToReportActions = {
    create,
    list: async () => {
      await call('list')
      if (mode === 'load-error' && !recovered.current) throw new Error('Sample read failure')
      if (responseShape === 'list-malformed') return [{ ...initial[0], slug: '../invalid' }]
      return rows
    },
    add: async (id, widget) => {
      addCount.current++
      await call(`add:${id}:source=${widget.dataSourceId ?? 'none'}`)
      const failed = failure(); if (failed) return failed
      if (responseShape === 'add-malformed') return { ok: true, data: { id: '' } }
      if (mode === 'partial' && addCount.current === 1) return { ok: false, reason: 'error' }
      return { ok: true, data: { id: 'fixture-widget' } }
    },
  }
  return <>
    {view === 'report-actions' ? (mode === 'empty' ? <EmptyDashboards key={workspace} actions={listActions} /> : <ReportsIndex key={workspace} dashboards={rows} actions={listActions} />) : <section aria-label="Sample answer" style={{ padding: 24, border: '1px solid var(--line)', borderRadius: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
      <div><h1 style={{ fontSize: 22 }}>Paid without access</h1><p style={{ fontSize: 14, color: 'var(--ink-2)' }}>Sample visualization · 3 orders</p></div>
      <AddToDashboard spec={{ fixture: true, visualization }} dataSourceId={source} actions={saveActions} compact={mode === 'empty'} />
    </section>}
    <aside data-flow-ready={ready} style={{ marginTop: 24, fontSize: 12, lineHeight: 1.7, overflowWrap: 'anywhere' }}>
      <button className="dx-btn-ghost" type="button" onClick={() => { recovered.current = true }}>Restore sample actions</button>
      {view === 'report-actions' && <div className={s.fixtureControls}>
        <label>Sample management response <select data-management-response value={responseShape} onChange={event => setResponseShape(event.target.value)}>
          <option value="normal">Normal</option><option value="malformed">Malformed acknowledgement</option>
          <option value="failure">Rejected change</option><option value="throw">Lost response</option>
          <option value="refresh-error">Refresh fails after acknowledgement</option><option value="navigate-error">Navigation fails after acknowledgement</option>
        </select></label>
        <button className="dx-btn-ghost" type="button" onClick={() => { workspaceRef.current = 'fixture-workspace-next'; setWorkspace(workspaceRef.current); setRows([{ id: 'replacement', slug: 'replacement', name: 'Replacement report', pinned: false, position: 0 }]) }}>Switch sample workspace</button>
        <p data-flow-workspace>{workspace}</p>
      </div>}
      {view === 'save' && <div>
        <label>Sample response <select data-save-response value={responseShape} onChange={event => setResponseShape(event.target.value)}>
          <option value="normal">Normal</option><option value="list-malformed">Malformed list</option>
          <option value="create-malformed">Malformed creation</option><option value="add-malformed">Malformed save</option>
        </select></label>
        <button type="button" className="dx-btn-ghost" onClick={() => setSource('fixture-source-next')}>Switch sample source</button>
        <button type="button" className="dx-btn-ghost" onClick={() => setVisualization(previous => previous + 1)}>Replace sample visualization</button>
        <p data-save-scope>{source}:{visualization}</p>
      </div>}
      <p data-flow-navigation>{navigation}</p><p>Local refreshes: {refreshes}</p>
      <pre data-flow-calls style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}>{calls.join('\n') || 'No calls'}</pre>
    </aside>
  </>
}
