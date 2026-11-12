'use client'

import { useMemo, useRef, useState } from 'react'
import { INITIAL_PROGRESS } from '@/lib/bootstrap/events'
import { ScanProgress, type ScanActions } from '@/app/app/setup/ScanProgress'
import { ScanProgressView } from '@/app/app/setup/ScanProgressView'
import type { ScanStatus } from '@/app/app/setup/scan-state'
import s from '@/app/app/setup/setup.module.css'

const empty = (): ScanStatus => ({ ...structuredClone(INITIAL_PROGRESS), active: false, resumeFrom: 'schema' })
export function scanSample(mode: string): ScanStatus {
  const s = empty()
  if (['idle', 'schema-only'].includes(mode) || mode.startsWith('post-') || ['waiting', 'done-response'].includes(mode)) return s
  s.phases.schema = 'done'; s.counts.tables = 42
  if (mode === 'schema') return s
  s.phases.context = 'running'; s.active = true; s.resumeFrom = 'context'
  if (['context', 'read-error', 'read-throw', 'read-malformed', 'slow', 'timeout'].includes(mode)) return s
  s.phases.context = mode === 'skipped' ? 'skipped' : 'done'
  s.counts.entities = 6; s.counts.rules = 9
  s.items.entities = ['Users', 'Subscriptions', 'Payments']
  s.items.rules = ['Exclude cancelled subscriptions and refunded payments from recurring revenue; confirm these inferred rules with the business owner before approving the KPI definition.']
  s.phases.kpi = 'running'; s.counts.kpis = 3; s.items.kpis = ['Paid without access', 'Paid job failure rate', 'Refund reconciliation']; s.resumeFrom = 'kpi'
  if (mode === 'kpi') return s
  s.active = false
  s.phases.kpi = mode === 'failed' ? 'failed' : 'done'
  s.error = mode === 'failed' ? 'Sample: proposal validation failed' : null
  s.resumeFrom = mode === 'failed' ? 'kpi' : null
  if (mode === 'zero') { s.counts.kpis = 0; s.items.kpis = [] }
  if (mode === 'overflow') { s.counts.tables = 1234567; s.items.kpis = ['International_subscription_entitlement_reconciliation_for_multiple_regions_and_annual_billing_periods'] }
  return s
}

/** Static gallery uses presentation only; mounting a completed scene sends no analytics/refresh. */
export function ScanGalleryView({ status, hasRepo }: { status: ScanStatus; hasRepo: boolean }) {
  return <div inert><ScanProgressView dataSourceId="fixture-gallery" hasRepo={hasRepo} status={status} onStart={() => {}} onRefresh={() => {}} /></div>
}

export function ScanFixture({ mode }: { mode: string }) {
  const [source, setSource] = useState('fixture-scan')
  const initial = useMemo(() => source === 'fixture-scan' ? scanSample(mode) : empty(), [source, mode])
  const backend = useRef(scanSample(mode))
  const broken = useRef(true)
  const [calls, setCalls] = useState<string[]>([])
  const [reports, setReports] = useState<string[]>([])
  const [refreshes, setRefreshes] = useState(0)
  const actions = useMemo<ScanActions>(() => ({
    request: async (input, init) => {
      const method = init?.method ?? 'GET'
      setCalls(rows => [...rows.slice(-29), `${method}:${String(input)}`])
      const snapshot = structuredClone(backend.current)
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
        const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, method === 'GET' && mode === 'timeout' ? 30000 : method === 'GET' && mode === 'slow' ? 7000 : 400)
        signal?.addEventListener('abort', abort, { once: true })
      })
      if (method === 'GET') {
        if (broken.current && mode === 'read-throw') throw new Error('Sample read failure')
        if (broken.current && mode === 'read-error') return Response.json({}, { status: 503 })
        if (broken.current && mode === 'read-malformed') return Response.json({})
        return Response.json({ status: snapshot })
      }
      if (mode === 'post-throw') throw new Error('Sample start failure')
      const gates: Record<string, [number, string]> = {
        'post-limit': [402, 'context_limit'], 'post-quota': [402, 'quota_exceeded'],
        'post-repository': [409, 'repo_invalid'], 'post-installation': [409, 'installation_not_found'],
        'post-denied': [403, 'forbidden'], 'post-failed': [503, 'trigger_required'],
      }
      if (gates[mode]) { const [status, error] = gates[mode]; return Response.json({ error }, { status }) }
      if (mode === 'done-response') { backend.current = scanSample('ready'); return Response.json({ done: true, status: backend.current }) }
      if (mode !== 'waiting') backend.current = scanSample('context')
      if (mode === 'post-conflict') return Response.json({ error: 'scan_in_progress' }, { status: 409 })
      return Response.json({ ok: true })
    },
    refresh: () => setRefreshes(n => n + 1),
    track: (event, data) => setReports(rows => [...rows, `${event}:${data?.source_id}`]),
  }), [mode])
  return <main style={{ padding: '32px 20px', maxWidth: 800, margin: '0 auto' }}>
    <aside style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-3)', marginBottom: 20, overflowWrap: 'anywhere' }}>
      DESIGN FIXTURE · Simulated scan responses only. No database, extraction job, analytics or server action is called.
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <button type="button" className="dx-btn-ghost" onClick={() => { broken.current = false }}>Restore sample reads</button>
        <button type="button" className="dx-btn-ghost" onClick={() => { backend.current = scanSample('ready') }}>Complete sample scan</button>
        <button type="button" className="dx-btn-ghost" onClick={() => { backend.current = empty(); setSource('fixture-other') }}>Switch sample source</button>
      </div>
      <p data-scan-calls>{JSON.stringify(calls)}</p><p data-scan-reports>{JSON.stringify(reports)} · Refreshes: {refreshes}</p>
    </aside>
    <div className={s.card}><ScanProgress dataSourceId={source} orgId="fixture-org" hasRepo={mode !== 'schema-only'} initialStatus={initial} actions={actions} /></div>
  </main>
}
