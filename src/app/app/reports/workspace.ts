import 'server-only'

import type { SupabaseClient, User } from '@supabase/supabase-js'

import { getOrgTimezone } from '@/lib/org/timezone'
import { countRows, getActivationState } from '@/lib/activation/state'
import { minutesSince, type ActivationState } from '@/lib/activation/logic'
import { serviceStage, type BoardState, type ServiceStage } from '@/lib/activation/overview-stage'
import { getBootstrapStatus } from '@/lib/bootstrap/status'
import { listAlerts, type AlertSummary } from '@/lib/alerts/server'
import { listIncidents } from '@/lib/alerts/incidents-server'
import { nextCheckAt } from '@/lib/alerts/health'
import { effectiveCheckInterval, expectedRangeLabel, type AlertOp } from '@/lib/alerts/evaluate'
import { isConnectionErrorCode } from '@/lib/supabase-oauth/errors'
import { getPlanLimit } from '@/lib/plans/limits'
import type { ReportContext, ReportExtraction, ReportInputs } from '@/lib/reports/build'
import { sourceMarkOf, type SourceMark } from '@/lib/dashboards/widget-source'
import { monitorDisplayHealth, type DisplayHealth } from '../monitors/presentation'

/* ============================================================
   Workspace snapshot — what the overview (home dashboard) and the report
   archive both read: every REAL data source as a service with its own stage,
   the monitor state behind it, and the inputs the report builder needs.

   The auto-provisioned demo source is never a service and its monitors never
   count. Reads may throw: the /app error boundary is the honest place for a
   fault on a monitoring product (never a false all-clear).
   ============================================================ */

export type MonitorHealthState = DisplayHealth
export type OverviewEngine = SourceMark

export interface OverviewMonitor {
  id: string
  name: string
  health: MonitorHealthState
  /** Pre-formatted last value, or null when the monitor has never produced one. */
  value: string | null
  /** The range the monitor expects to stay inside (inverted firing operator), null for anomaly. */
  expected: string | null
  agoMin: number | null
}

/** One data source, as the overview and the report archive show it. */
export interface OverviewService {
  id: string
  name: string
  engine: OverviewEngine
  repoAttached: boolean
  stage: ServiceStage
  board: BoardState
  recovery: 'reconnect' | 'scan_failed' | null
  reconnectHref: string
  /** Enabled monitors on this source. */
  monitorCount: number
  /** All monitors on this source. */
  monitorTotal: number
  firingCount: number
  erroredCount: number
  pendingCheckCount: number
  brokenCount: number
  checkedAgo: number | null
  nextMin: number
  kpiHref: string
  /** Rows ordered by health priority and capped. */
  monitors: OverviewMonitor[]
  /** KPI proposals awaiting approval on this source. */
  pendingCount: number
}

export interface Workspace {
  orgId: string
  /** owner/admin/member — viewers read, they don't connect or approve. */
  canManage: boolean
  /** owner/admin — workspace settings such as the home dashboard. */
  isOrgAdmin: boolean
  services: OverviewService[]
  /** A Supabase account is authorized but no project became a source yet. */
  connectionPending: boolean
  intervalMin: number
  timeZone: string
  /** The clock every relative time and report was computed with. */
  now: number
  /** Incident acknowledgement columns exist (the ack migration is applied). */
  ackReady: boolean
  /** ORG activation state — what the home's onboarding checklist renders from. */
  activation: ActivationState
  kpisAccepted: number
  /** Unscoped report inputs — a page scopes them to a service with buildReports(inputs, scope). */
  reportInputs: ReportInputs
}

/** Monitor rows a service card shows before it links to the full list. */
const CARD_ROWS = 3
/** Sources whose scan progress is read per request (each read is a few indexed queries). */
const SCAN_READS = 12

/**
 * Card order. The list is capped, so a firing monitor must never be pushed off it by newer healthy
 * ones — priority first, creation order (the query's `created_at desc`, kept by a stable sort) inside.
 */
const HEALTH_RANK: Record<DisplayHealth, number> = { incident: 0, error: 1, pending: 2, healthy: 3, paused: 4 }

/** Metric values are raw numbers from the tenant DB — group digits so ₩3,120,000 is readable. */
function makeFmt(intl: string) {
  return (v: number | null): string | null => {
    if (v == null) return null
    return Number.isInteger(v) ? v.toLocaleString(intl) : v.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
}

export async function loadWorkspace(supabase: SupabaseClient, user: User, orgId: string, locale: string): Promise<Workspace> {
  const fmtValue = makeFmt(locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US')
  const [activation, alerts, { data: orgRows }, { data: sourceRows }, { data: memberRows }, { data: connectionRows }, timezone, incidentHistory, { data: extractionRows }, { data: contextRows }] =
    await Promise.all([
      getActivationState(supabase, orgId),
      listAlerts(supabase, orgId),
      supabase.from('organizations').select('plan').eq('id', orgId).limit(1),
      supabase
        .from('data_sources')
        .select('id, name, is_demo, engine, provider, repo_id')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('is_demo', { ascending: true })
        .order('name', { ascending: true }),
      supabase.from('organization_members').select('role').eq('org_id', orgId).eq('user_id', user.id).limit(1),
      supabase.from('provider_connections').select('id, provider, status').eq('org_id', orgId).eq('provider', 'supabase').is('deleted_at', null).limit(1),
      getOrgTimezone(supabase, orgId),
      // Throws on a real read fault (never a false all-clear); degrades only on the unapplied ack migration.
      listIncidents(supabase, orgId),
      supabase
        .from('kpi_extractions')
        .select('data_source_id, status, created_at, completed_at, proposed_count')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('data_source_context').select('data_source_id, status, generated_at, source_repo_id').eq('org_id', orgId).limit(100),
    ])

  type SourceRow = { id: string; name: string; is_demo: boolean; engine: string; provider: string; repo_id: string | null }
  const realSources = ((sourceRows ?? []) as SourceRow[]).filter((r) => !r.is_demo)
  const role = (memberRows?.[0] as { role?: string } | undefined)?.role ?? null

  // Cadence is per plan and floored to the cron period (free 2h / basic 10m / standard+ 5m).
  const plan = (orgRows?.[0] as { plan?: string | null } | undefined)?.plan ?? null
  const intervalSec = effectiveCheckInterval(getPlanLimit(plan, 'alert_min_check_interval'))
  const now = Date.now()

  // Per-source reads: pending proposals (counted server-side) and scan progress (best-effort).
  const [pendingCounts, scans] = await Promise.all([
    Promise.all(
      realSources.map((r) =>
        countRows('pending kpi proposals', supabase.from('kpi_catalog').select('id', { count: 'exact', head: true }).eq('data_source_id', r.id).eq('status', 'proposed')),
      ),
    ),
    Promise.all(
      realSources.map((r, i) =>
        i < SCAN_READS
          ? getBootstrapStatus(r.id).catch((e) => {
              // Never let a progress read break the page.
              console.error('[workspace] scan status read failed:', e)
              return null
            })
          : Promise.resolve(null),
      ),
    ),
  ])

  const services: OverviewService[] = realSources.map((source, index) => {
    const real = alerts.filter((a) => a.dataSourceId === source.id)
    const watched = real.filter((a) => a.enabled)
    const firing = watched.filter((a) => a.status === 'firing')
    const errored = watched.filter((a) => !!a.lastError)
    const broken = watched.filter((a) => isConnectionErrorCode(a.lastError))
    const checked = watched.filter((a) => !!a.lastCheckedAt)
    const lastCheckedAt = watched.reduce<string | null>((max, a) => (a.lastCheckedAt && (!max || a.lastCheckedAt > max) ? a.lastCheckedAt : max), null)
    const status = scans[index]
    const scan = status ? { context: status.phases.context, kpi: status.phases.kpi } : null
    const pendingCount = pendingCounts[index] ?? 0

    const { stage, board, recovery } = serviceStage({
      scan,
      pendingProposals: pendingCount,
      monitorsTotal: real.length,
      monitorsEnabled: watched.length,
      monitorsChecked: checked.length,
      firing: firing.length,
      errored: errored.length,
      connectionErrors: broken.length,
    })
    const nextAt = nextCheckAt({ enabled: true, lastCheckedAt }, intervalSec, now)

    // `operator` stores the FIRING condition, so rows invert it to state the range the monitor
    // expects to stay inside (expectedRangeLabel). Anomaly monitors have no fixed bound.
    const toRow = (a: AlertSummary): OverviewMonitor => {
      // a goal monitor's fixed line (if any) lives in its structured rule; its legacy threshold
      // column is a placeholder
      const rule = a.condition
      const fixedLine = rule ? rule.strategy === 'absolute' : a.type !== 'anomaly'
      const threshold = fixedLine ? fmtValue(rule?.strategy === 'absolute' ? rule.threshold : a.threshold) : null
      const op = rule?.strategy === 'absolute' ? rule.operator : (a.operator as AlertOp)
      return {
        id: a.id,
        name: a.name,
        health: monitorDisplayHealth(a),
        value: fmtValue(a.lastValue),
        expected: !threshold ? null : expectedRangeLabel(op, threshold),
        agoMin: minutesSince(a.lastCheckedAt, now),
      }
    }
    const ordered = [...real].sort((a, b) => HEALTH_RANK[monitorDisplayHealth(a)] - HEALTH_RANK[monitorDisplayHealth(b)])

    return {
      id: source.id,
      name: source.name,
      engine: sourceMarkOf(source),
      repoAttached: !!source.repo_id,
      stage,
      board,
      recovery,
      reconnectHref: `/api/connect-supabase/authorize?${new URLSearchParams({
        ...(broken[0]?.connectionId ? { connectionId: broken[0].connectionId } : {}),
        returnTo: '/app/overview',
      })}`,
      monitorCount: watched.length,
      monitorTotal: real.length,
      firingCount: firing.length,
      erroredCount: errored.length,
      pendingCheckCount: watched.filter((a) => monitorDisplayHealth(a) === 'pending').length,
      brokenCount: broken.length,
      checkedAgo: minutesSince(lastCheckedAt, now),
      nextMin: nextAt ? Math.max(0, Math.round((nextAt.getTime() - now) / 60_000)) : 0,
      kpiHref: `/app/sources/${source.id}/kpis`,
      monitors: ordered.slice(0, CARD_ROWS).map(toRow),
      pendingCount,
    }
  })

  // Report inputs — every report is derived from the records read above.
  const realIds = new Set(realSources.map((r) => r.id))
  const alertSource = new Map(alerts.map((a) => [a.id, a.dataSourceId]))
  const latestExtraction = new Map<string, ReportExtraction>()
  for (const row of (extractionRows ?? []) as { data_source_id: string; status: string; created_at: string; completed_at: string | null; proposed_count: number | null }[]) {
    if (!realIds.has(row.data_source_id) || latestExtraction.has(row.data_source_id)) continue
    latestExtraction.set(row.data_source_id, { dataSourceId: row.data_source_id, status: row.status, createdAt: row.created_at, completedAt: row.completed_at, proposedCount: row.proposed_count })
  }
  const contexts: ReportContext[] = ((contextRows ?? []) as { data_source_id: string; status: string; generated_at: string | null; source_repo_id: string | null }[])
    .filter((row) => realIds.has(row.data_source_id))
    .map((row) => ({ dataSourceId: row.data_source_id, status: row.status, generatedAt: row.generated_at, fromRepo: row.source_repo_id != null }))
  const realAlerts = alerts.filter((a) => realIds.has(a.dataSourceId))

  return {
    orgId,
    canManage: role !== null && role !== 'viewer',
    isOrgAdmin: role === 'owner' || role === 'admin',
    services,
    connectionPending: realSources.length === 0 && (connectionRows ?? []).length > 0,
    intervalMin: Math.round(intervalSec / 60),
    timeZone: timezone,
    now,
    ackReady: incidentHistory.ackReady,
    activation,
    kpisAccepted: activation.counts.kpisAccepted,
    reportInputs: {
      now,
      timeZone: timezone,
      services,
      // Demo-source incidents never become the user's reports.
      incidents: incidentHistory.incidents
        .map((inc) => ({ ...inc, dataSourceId: alertSource.get(inc.alertId) ?? null }))
        .filter((inc) => inc.dataSourceId !== null && realIds.has(inc.dataSourceId)),
      extractions: [...latestExtraction.values()],
      contexts,
      monitoringSince: realAlerts.reduce<string | null>((min, a) => (!min || a.createdAt < min ? a.createdAt : min), null),
    },
  }
}
