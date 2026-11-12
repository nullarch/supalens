'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  INITIAL_PROGRESS,
} from '@/lib/bootstrap/events'
import { track } from '@/utils/analytics'
import { ScanProgressView } from './ScanProgressView'
import { scanFailed, scanReady, scanGate, type ScanStatus, type ScanGate, type ScanRequest } from './scan-state'

const INITIAL: ScanStatus = {
  phases: { ...INITIAL_PROGRESS.phases },
  counts: { ...INITIAL_PROGRESS.counts },
  items: { entities: [], rules: [], kpis: [] },
  error: null,
  active: false,
  resumeFrom: 'schema',
}

const POLL_MS = 3000
/** sessionStorage key holding the scan's client-side start time, for the Golden Path SLO. */
const startedKey = (id: string) => `supalens.scan.started.${id}`

export interface ScanActions { request: typeof fetch; refresh: () => void; track: typeof track }

export interface ScanProgressProps {
  dataSourceId: string
  orgId: string
  /** Repo attached → the scan reads code too (tier 2); otherwise schema only (tier 1). */
  hasRepo: boolean
  /** Server-rendered starting point, so the first paint already shows real state. */
  initialStatus: ScanStatus | null
  actions?: ScanActions
}

/**
 * The unified scan step: one job that reads the schema, derives the business rules and proposes
 * KPIs, with progress reported from real events only.
 *
 * Every counter starts at "—" and is filled by a measured value: the table count is what the
 * introspection cache wrote, entities/rules come from parsing the finished SUPALENS.md, and KPIs
 * climb as the agent validates each proposal. Nothing here interpolates a rising number, so the
 * screen never claims progress the backend has not actually made.
 */
export function ScanProgress(props: ScanProgressProps) {
  return <ScanController key={props.dataSourceId} {...props} />
}

function ScanController({ dataSourceId, orgId, hasRepo, initialStatus, actions }: ScanProgressProps) {
  const router = useRouter()
  const request = actions?.request ?? fetch
  const refreshPage = actions?.refresh ?? router.refresh
  const report = actions?.track ?? track
  const [status, setStatus] = useState<ScanStatus>(initialStatus ?? INITIAL)
  const [requestState, setRequestState] = useState<ScanRequest>('idle')
  const [gate, setGate] = useState<ScanGate>(null)
  const [reading, setReading] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const mounted = useRef(true)
  const inFlight = useRef<AbortController | null>(null)
  const submitting = useRef(false)
  const reportedDone = useRef(false)

  const polling = status.active || requestState === 'waiting'
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; inFlight.current?.abort() }
  }, [])

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    const controller = new AbortController()
    inFlight.current = controller
    setReading(true)
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await request(`/api/setup/scan?dataSourceId=${encodeURIComponent(dataSourceId)}`, { cache: 'no-store', signal: controller.signal })
      if (!res.ok) throw new Error('Status unavailable')
      const body = (await res.json()) as { status?: ScanStatus }
      if (!body.status) throw new Error('Missing status')
      if (!mounted.current || controller.signal.aborted) return
      setStatus(body.status)
      setReadFailed(false)
      if (body.status.active || scanFailed(body.status) || scanReady(body.status)) setRequestState('idle')
      if (body.status.active) setGate(null)
    } catch {
      if (mounted.current) setReadFailed(true)
    } finally {
      clearTimeout(timeout)
      if (inFlight.current === controller) {
        inFlight.current = null
        if (mounted.current) setReading(false)
      }
    }
  }, [dataSourceId, request])

  useEffect(() => {
    if (!polling) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [polling, refresh])

  // Terminal transitions: stop the spinner, report the SLO, and let the server page recompute
  // activation so the next step opens.
  useEffect(() => {
    if (scanReady(status) && !reportedDone.current) {
      reportedDone.current = true
      let durationMs: number | null = null
      try {
        const raw = sessionStorage.getItem(startedKey(dataSourceId))
        if (raw) {
          const started = Number(raw)
          if (Number.isFinite(started)) durationMs = Math.max(0, Date.now() - started)
          sessionStorage.removeItem(startedKey(dataSourceId))
        }
      } catch {
        /* sessionStorage unavailable — report without a duration */
      }
      report('business_scan_completed', {
        org_id: orgId,
        source_id: dataSourceId,
        tier: hasRepo ? 2 : 1,
        entity_count: status.counts.entities ?? -1,
        rule_count: status.counts.rules ?? -1,
        kpi_count: status.counts.kpis ?? -1,
        ...(durationMs != null ? { duration_ms: durationMs } : {}),
      })
      setRequestState('idle')
      refreshPage()
    }
    if (scanFailed(status)) setRequestState('idle')
  }, [status, dataSourceId, orgId, hasRepo, report, refreshPage])

  async function start() {
    if (submitting.current || status.active || requestState !== 'idle' || readFailed) return
    submitting.current = true
    setGate(null)
    setRequestState('submitting')
    reportedDone.current = false
    try {
      sessionStorage.setItem(startedKey(dataSourceId), String(Date.now()))
    } catch {
      /* SLO timing is best-effort */
    }
    report('business_scan_started', { org_id: orgId, source_id: dataSourceId, tier: hasRepo ? 2 : 1 })
    try {
      const res = await request('/api/setup/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataSourceId }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; done?: boolean; status?: ScanStatus }
      if (!mounted.current) return
      if (!res.ok) {
        const nextGate = scanGate(res.status, body.error)
        setGate(nextGate)
        setRequestState(nextGate === 'conflict' ? 'waiting' : 'idle')
        if (nextGate === 'conflict') await refresh()
        return
      }
      if (body.done && body.status) {
        setStatus(body.status)
        setRequestState('idle')
        return
      }
      setRequestState('waiting')
      await refresh()
    } catch {
      if (mounted.current) { setRequestState('idle'); setGate('failed') }
    } finally { submitting.current = false }
  }

  return <ScanProgressView dataSourceId={dataSourceId} hasRepo={hasRepo} status={status}
    requestState={requestState} gate={gate} reading={reading} readFailed={readFailed}
    onStart={() => void start()} onRefresh={() => void refresh()} />
}
