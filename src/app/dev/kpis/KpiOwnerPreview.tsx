'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { KpiReviewDialog } from '@/app/app/sources/KpiReviewModal'
import { KpiReviewClient, type ApplyPlan, type ApplyKpisResult, type KpiReviewActions } from '@/app/app/sources/[id]/kpis/KpiReviewClient'
import { ownerRows } from './fixtures'
import type { KpiExtractionRow } from '@/lib/kpi/types'

type ApplyInput = { kpiIds?: string[]; withAlerts?: boolean; dashboardId?: string; dryRun?: boolean; status?: 'proposed' | 'dismissed' }
type Pending = { label: string; resolve: (response: Response) => void; result: () => Response }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

/** No network transport: proposals, dry-runs and approval outcomes are sample data in memory. */
export function KpiOwnerPreview({ mode, modal }: { mode: string; modal: boolean }) {
  const t = useTranslations('appKpis')
  const initialRows = mode === 'empty' ? [] : ownerRows
  const rows = useRef(initialRows)
  const pending = useRef<Pending[]>([])
  const previewAttempts = useRef(0)
  const [pendingLabels, setPendingLabels] = useState<string[]>([])
  const [calls, setCalls] = useState<string[]>([])
  const [refreshes, setRefreshes] = useState(0)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [sourceId, setSourceId] = useState('fixture-source')
  const extractionAttempts = useRef(0)
  const extraction = useRef<KpiExtractionRow | null>(null)
  const sourceName = 'Northstar / international-subscription-entitlement-processing-production'

  const gate = useCallback((label: string, result: () => Response) => new Promise<Response>(resolve => {
    pending.current.push({ label, result, resolve })
    setPendingLabels(pending.current.map(item => item.label))
  }), [])

  const request = useCallback<KpiReviewActions['request']>(async (input, init) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as ApplyInput : {}
    const selected = rows.current.filter(row => body.kpiIds?.includes(row.id))
    const watchable = selected.filter(row => row.alertConfig && body.withAlerts !== false)
    const cap = mode === 'cap'
    const plan: ApplyPlan = {
      selected: selected.length, monitorsToCreate: cap ? Math.min(1, watchable.length) : watchable.length,
      dashboardOnly: selected.filter(row => !row.alertConfig || body.withAlerts === false).map(row => ({ kpiId: row.id, key: row.key, title: row.title, reason: body.withAlerts === false ? 'alerts_off' : 'snapshot_only' })),
      capBlocked: cap ? [
        ...watchable.slice(1).map(row => ({ kpiId: row.id, key: row.key, title: row.title, cap: 'alerts_per_org' as const })),
        ...selected.filter(row => row.id === 'fixture-snapshot').map(row => ({ kpiId: row.id, key: row.key, title: row.title, cap: 'widgets_per_dashboard' as const })),
      ] : [],
      alreadyApplied: 0, cadenceSeconds: 7200, alertLimit: cap ? 1 : 12,
    }
    if (url.endsWith('/apply') && body.dryRun) {
      previewAttempts.current++
      if (mode === 'preview-error' && previewAttempts.current === 1) return json({ error: 'Sample preview unavailable' }, 503)
      if (mode === 'pending') return gate(`preview:${body.kpiIds?.join(',')}:${body.withAlerts}`, () => json({ plan }))
      return json({ plan })
    }
    if (url.endsWith('/apply')) return gate('approval', () => {
      setCalls(items => [...items, `apply:${body.kpiIds?.join(',')}:${body.withAlerts}:${body.dashboardId ?? 'new'}`])
      if (mode === 'apply-error') return json({ message: 'Sample approval failed. No KPI was changed.' }, 503)
      const items: ApplyKpisResult['items'] = selected.map((row, index) => {
        if ((mode === 'partial' && index === 1) || plan.capBlocked.some(item => item.kpiId === row.id && item.cap === 'widgets_per_dashboard')) {
          return { kpiId: row.id, key: row.key, ok: false, errorKind: mode === 'cap' ? 'cap' : 'validation', error: 'Sample validation or report limit failure. No production query ran.' }
        }
        const alertBlocked = plan.capBlocked.some(item => item.kpiId === row.id && item.cap === 'alerts_per_org')
        return { kpiId: row.id, key: row.key, ok: true, widgetId: `sample-widget-${index}`,
          ...(row.alertConfig && body.withAlerts !== false && !alertBlocked ? { alertId: `sample-alert-${index}` } : {}),
          ...(alertBlocked ? { error: 'Sample monitor limit; widget only.', errorKind: 'cap' as const } : {}),
        }
      })
      rows.current = rows.current.map(row => items.some(item => item.kpiId === row.id && item.ok) ? { ...row, status: 'accepted', applied: { dashboardId: 'fixture-report' } } : row)
      const result: ApplyKpisResult = { ok: items.every(item => item.ok), dashboardId: 'fixture-report', dashboardSlug: 'sample-report', applied: items.filter(item => item.ok).length, failed: items.filter(item => !item.ok).length, items, plan }
      return json(result)
    })
    if (url.endsWith('/extract')) {
      const attempt = ++extractionAttempts.current
      setCalls(items => [...items, `extract:${url}`])
      const response = gate('extraction', () => {
        if (mode === 'extract-conflict' || (mode === 'extract-retry' && attempt === 1)) return json({ error: 'repo_invalid' }, 409)
        if (mode === 'extract-malformed') return json({ ok: true })
        if (mode === 'extract-throw') return json({})
        if (['extract-accepted', 'extract-running', 'extract-retry'].includes(mode)) {
          extraction.current = { id: 'fixture-extraction', orgId: 'fixture-org', dataSourceId: sourceId, status: 'running', tier: 1, proposedCount: null, error: null, triggerRunId: null, createdAt: '2026-09-08T00:00:00Z', completedAt: null }
          return mode === 'extract-running' ? json({ error: 'extraction_in_progress' }, 409) : json({ ok: true, extractionId: 'fixture-extraction', tier: 1 })
        }
        return json({ error: 'quota_exceeded' }, 402)
      })
      if (mode === 'extract-throw') { await response; throw new Error('Local transport failure') }
      return response
    }
    if (init?.method === 'PATCH') return gate(`proposal:${body.status}`, () => {
      if (mode === 'patch-error' || (mode === 'undo-error' && body.status === 'proposed')) return json({ error: 'Sample proposal update failed' }, 503)
      rows.current = rows.current.map(row => body.kpiIds?.includes(row.id) ? { ...row, status: body.status ?? row.status } : row)
      return json({ ok: true })
    })
    return json({ kpis: rows.current, extraction: extraction.current })
  }, [gate, mode, sourceId])
  const refresh = useCallback(() => setRefreshes(value => value + 1), [])

  const content = <KpiReviewClient sourceId={sourceId} sourceName={sourceName} canManage
    variant={modal ? 'modal' : 'page'} onBusyChange={setBusy} actions={{ request, refresh }}
    initialKpis={initialRows} initialExtraction={null}
    dashboards={[{ id: 'fixture-report', name: 'International subscription entitlement analysis', slug: 'sample-report', pinned: false, position: 0 }]} />

  const controls = <aside style={{ borderBottom: '1px solid var(--line)', paddingBottom: 16, marginBottom: 24 }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7, marginBottom: 12 }}>
        DESIGN FIXTURE · Local sample proposals and responses only. No query, approval, extraction or server action is sent.
      </p>
      <button type="button" className="dx-btn-ghost" onClick={() => {
        const next = pending.current.shift()
        next?.resolve(next.result())
        setPendingLabels(pending.current.map(item => item.label))
      }}>Resolve sample request</button>
      <button type="button" className="dx-btn-ghost" data-fixture-switch onClick={() => { extraction.current = null; setSourceId('fixture-source-b') }}>Switch sample source</button>
      <p data-fixture-pending={pendingLabels.join('|')} data-fixture-refresh={refreshes} data-fixture-calls={calls.join('|')}
        style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7, marginTop: 10, overflowWrap: 'anywhere' }}>
        Sample response: {mode} · Waiting: {pendingLabels.length} · Local refreshes: {refreshes}
      </p>
    </aside>
  return <main style={{ padding: 'clamp(32px, 5vw, 48px) clamp(20px, 3.4vw, 36px) 80px', maxWidth: 1096, margin: '0 auto' }}>
    {modal ? <button type="button" className="dx-btn-ghost" onClick={() => setOpen(true)}>Open review preview</button> : controls}
    {modal ? open && <KpiReviewDialog onClose={() => setOpen(false)} busy={busy} sourceName={sourceName}
      loading={mode === 'loading'} error={mode === 'load-error' ? t('loadFailed') : null}>
      <div>{controls}{content}</div>
    </KpiReviewDialog> : content}
  </main>
}
