/**
 * Auto-KPI shared contracts (design: docs/auto-kpi-plan.md).
 *
 * Shared between the Next.js BFF and the Trigger.dev runtime — no 'server-only'
 * and no React/server imports (same rule as src/lib/viz/spec.ts, which this builds on).
 */
import { z } from 'zod'
import { ChartSpec, VisualizationSpec } from '@/lib/viz/spec'

export const KPI_CATEGORIES = ['growth', 'revenue', 'engagement', 'ops', 'funnel', 'custom'] as const
export type KpiCategory = (typeof KPI_CATEGORIES)[number]

/** Alert suggestion attached to a KPI proposal — mapped onto `alerts` rows at apply time. */
export const KpiAlertConfig = z.object({
  type: z.enum(['threshold', 'anomaly']),
  operator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'neq']).optional(),
  threshold: z.number().finite().optional(),
  /** z-score cutoff for anomaly alerts (alerts.sensitivity). */
  sensitivity: z.number().min(1).max(6).optional(),
  /** anomaly alerts: which way is bad — "down" (revenue, signups), "up" (errors, failures), "both".
   *  Absent = both (the legacy two-sided reading). Applied as a goal-monitor condition. */
  direction: z.enum(['down', 'up', 'both']).optional(),
})
export type KpiAlertConfig = z.infer<typeof KpiAlertConfig>

/**
 * Why a KPI gets NO monitor. "Monitor all" has to be honest: approving 7 KPIs is not
 * monitoring 7 KPIs, and before this every un-monitorable KPI was silently dashboard-only
 * with no reason anywhere. propose_kpi now requires an alert OR one of these, so the review
 * UI can always say WHY a row will only ever be a widget.
 */
export const NO_MONITOR_REASONS = ['not_time_series', 'categorical', 'snapshot_only', 'low_signal'] as const
export type NoMonitorReason = (typeof NO_MONITOR_REASONS)[number]

export const KpiNoMonitor = z.object({
  kind: z.literal('none'),
  reason: z.enum(NO_MONITOR_REASONS),
  note: z.string().max(120).optional(),
})
export type KpiNoMonitor = z.infer<typeof KpiNoMonitor>

/**
 * `kpi_catalog.alert_config` is ONE jsonb column holding either shape (no migration): a real
 * alert config, or the `{kind:'none'}` marker. These two readers are the only place that
 * decides which — everything downstream keeps seeing a plain `KpiAlertConfig | null`, so a
 * no-monitor row can never be mistaken for a monitorable one (apply.ts would otherwise try to
 * insert an alert with no operator).
 */
export function alertConfigOf(raw: unknown): KpiAlertConfig | null {
  const parsed = KpiAlertConfig.safeParse(raw)
  return parsed.success ? parsed.data : null
}
export function noMonitorOf(raw: unknown): KpiNoMonitor | null {
  const parsed = KpiNoMonitor.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Why this KPI applies to this service — the trust surface shown in the review UI. */
export const KpiEvidence = z.object({
  kind: z.enum(['file', 'table', 'event']),
  ref: z.string().min(1).max(300),
  note: z.string().max(300).optional(),
})
export type KpiEvidence = z.infer<typeof KpiEvidence>

/**
 * Raw zod shape for the in-process `propose_kpi` MCP tool (same style as ProposeVizInput).
 * `queryId` must reference a prior successful `execute_sql` result — the SQL is bound from
 * that stashed result, which is what makes every catalog entry proven-runnable.
 */
export const ProposeKpiInput = {
  queryId: z.string().min(1),
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,63}$/, 'snake_case slug, e.g. "daily_revenue"'),
  title: z.string().min(1).max(120),
  category: z.enum(KPI_CATEGORIES),
  description: z.string().min(1).max(500),
  importance: z.number().int().min(1).max(5),
  chart: ChartSpec,
  alert: KpiAlertConfig.optional(),
  /** Required when `alert` is absent — the model must SAY why this KPI can't be watched. */
  noMonitorReason: z.enum(NO_MONITOR_REASONS).optional(),
  noMonitorNote: z.string().max(120).optional(),
  evidence: z.array(KpiEvidence).min(1).max(8),
}

/** A validated proposal as the sink receives it (SQL + full spec bound from the stashed result). */
export interface KpiProposal {
  key: string
  title: string
  category: KpiCategory
  description: string
  importance: number
  metricSql: string
  vizSpec: VisualizationSpec
  /** Exactly one of these is set — validateKpiProposal rejects a proposal carrying neither. */
  alertConfig?: KpiAlertConfig
  noMonitor?: KpiNoMonitor
  evidence: KpiEvidence[]
}

/** Mirror of VizSink: the host collects accepted proposals; the tool itself touches no DB. */
export interface KpiSink {
  onKpi: (proposal: KpiProposal) => void | Promise<void>
}

export type KpiRowStatus = 'proposed' | 'accepted' | 'dismissed' | 'stale'
export type KpiExtractionStatus = 'running' | 'completed' | 'failed'

/** kpi_catalog row as the app consumes it (queried via the untyped admin client). */
export interface KpiCatalogRow {
  id: string
  orgId: string
  dataSourceId: string
  extractionId: string | null
  key: string
  title: string
  category: KpiCategory
  description: string | null
  importance: number
  metricSql: string
  vizSpec: VisualizationSpec
  /** A real monitor config, or null. Never the `{kind:'none'}` marker — see alertConfigOf. */
  alertConfig: KpiAlertConfig | null
  /** Set when the proposal explicitly declined a monitor; null for legacy rows (reason unknown). */
  noMonitor: KpiNoMonitor | null
  evidence: KpiEvidence[]
  status: KpiRowStatus
  applied: {
    dashboardId?: string
    widgetId?: string
    savedQueryId?: string
    alertId?: string
  } | null
  createdAt: string
  updatedAt: string
}

export interface KpiExtractionRow {
  id: string
  orgId: string
  dataSourceId: string
  status: KpiExtractionStatus
  tier: 1 | 2
  proposedCount: number | null
  error: string | null
  triggerRunId: string | null
  createdAt: string
  completedAt: string | null
}
