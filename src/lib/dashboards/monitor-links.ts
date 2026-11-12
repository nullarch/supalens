/**
 * Widget ↔ monitor linkage.
 *
 * A report widget and a monitor can describe the SAME metric, but nothing in the schema says
 * so — there is no `widget_id` on `alerts`, and adding one would need a migration. Two facts
 * the app already records get us there without one:
 *
 *   1. PROVENANCE (exact). `applyKpis` stamps `kpi_catalog.applied = {widgetId, alertId, …}`
 *      when it creates a widget and a monitor from the same KPI. That mapping is authoritative
 *      and is tried first.
 *   2. SQL IDENTITY (fallback). A widget added from Ask — or a KPI applied before `applied`
 *      was recorded — has no provenance, but a monitor watching it runs the same metric SQL
 *      against the same data source (`applyKpis` writes one `row.metricSql` to both). Matching
 *      on whitespace-normalised text is deliberately conservative: it can MISS a link when the
 *      SQL was hand-edited, but it cannot invent one between two different metrics. Case is
 *      NOT folded — `where country = 'KR'` and `'kr'` are different metrics.
 *
 * The matching rules are pure (unit-tested); the io shell at the bottom only feeds them rows.
 * It takes a Supabase client instead of creating one, so it works with the RLS-scoped user
 * client the dashboard reads use.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** A monitor watching the metric a widget renders. */
export interface MonitorLink {
  alertId: string
  status: 'normal' | 'firing'
  enabled: boolean
  lastCheckedAt: string | null
  /** Newest `alert_events` fired row with no later resolved row — an incident still open. */
  openIncidentEventId?: string
  /** Which rule produced the link (provenance beats SQL identity). */
  via: 'provenance' | 'sql'
}

/** The verified KPI definition behind an auto-KPI widget (its trust surface). */
export interface WidgetKpiDefinition {
  key: string
  description: string | null
  evidence: Array<{ kind: string; ref: string; note?: string }>
}

export interface WidgetRef {
  id: string
  dataSourceId: string | null
  /** The widget's re-runnable SQL, when the stored spec is a SQL-backed envelope. */
  sql: string | null
}

export interface AlertRef {
  id: string
  dataSourceId: string
  metricSql: string
  status: 'normal' | 'firing'
  enabled: boolean
  lastCheckedAt: string | null
  createdAt: string
}

/** One `kpi_catalog.applied` pair — the widget and the monitor born from the same KPI. */
export interface AppliedRef {
  widgetId: string
  alertId: string
}

export interface EventRef {
  id: string
  alertId: string
  kind: string
  createdAt: string
}

/**
 * Whitespace-normalised SQL for identity comparison: collapse runs of whitespace, drop
 * trailing semicolons/space. Nothing else — see the case note in the module header.
 */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/[\s;]+$/, '').trim()
}

/**
 * Per alert, the id of the currently OPEN incident: the newest event, when that event is a
 * 'fired' one (a later 'resolved' row would be newer and close it). Same definition the
 * incidents screen uses, so a widget and the incident list never disagree.
 */
export function openIncidentByAlert(events: EventRef[]): Record<string, string> {
  const newest = new Map<string, EventRef>()
  for (const e of events) {
    const cur = newest.get(e.alertId)
    if (!cur || Date.parse(e.createdAt) > Date.parse(cur.createdAt)) newest.set(e.alertId, e)
  }
  const out: Record<string, string> = {}
  for (const [alertId, e] of newest) {
    if (e.kind === 'fired') out[alertId] = e.id
  }
  return out
}

/** Enabled monitors win a tie, then the most recently created one. */
function betterAlert(a: AlertRef, b: AlertRef): AlertRef {
  if (a.enabled !== b.enabled) return a.enabled ? a : b
  return Date.parse(a.createdAt) >= Date.parse(b.createdAt) ? a : b
}

/**
 * Resolve each widget to the monitor watching it, or to nothing. Widgets with no match are
 * absent from the result — the board renders them exactly as before.
 */
export function matchMonitorLinks(
  widgets: WidgetRef[],
  alerts: AlertRef[],
  applied: AppliedRef[],
  events: EventRef[],
): Record<string, MonitorLink> {
  const alertById = new Map(alerts.map((a) => [a.id, a]))
  const openIncidents = openIncidentByAlert(events)
  const out: Record<string, MonitorLink> = {}

  const link = (a: AlertRef, via: MonitorLink['via']): MonitorLink => ({
    alertId: a.id,
    status: a.status,
    enabled: a.enabled,
    lastCheckedAt: a.lastCheckedAt,
    ...(openIncidents[a.id] ? { openIncidentEventId: openIncidents[a.id] } : {}),
    via,
  })

  // 1) recorded provenance
  for (const p of applied) {
    const a = alertById.get(p.alertId)
    if (a) out[p.widgetId] = link(a, 'provenance')
  }

  // 2) SQL identity, for whatever provenance did not cover
  const bySql = new Map<string, AlertRef>()
  for (const a of alerts) {
    const k = `${a.dataSourceId}\n${normalizeSql(a.metricSql)}`
    const cur = bySql.get(k)
    bySql.set(k, cur ? betterAlert(cur, a) : a)
  }
  for (const w of widgets) {
    if (out[w.id] || !w.dataSourceId || !w.sql) continue
    const a = bySql.get(`${w.dataSourceId}\n${normalizeSql(w.sql)}`)
    if (a) out[w.id] = link(a, 'sql')
  }

  return out
}

type Client = Pick<SupabaseClient, 'from'>

export interface WidgetMonitorInfo {
  links: Record<string, MonitorLink>
  definitions: Record<string, WidgetKpiDefinition>
}

const EMPTY: WidgetMonitorInfo = { links: {}, definitions: {} }

/** How many recent alert events to scan for open incidents (newest first). */
const EVENT_SCAN_LIMIT = 300

/**
 * Read the rows `matchMonitorLinks` needs and run it, plus the KPI definition behind each
 * auto-KPI widget. Best-effort: any failed read degrades to "no linkage", never to a broken
 * board (the same fail-open convention the widget live-refresh uses).
 */
export async function getWidgetMonitorInfo(
  client: Client,
  orgId: string,
  widgets: WidgetRef[],
): Promise<WidgetMonitorInfo> {
  const sourceIds = [...new Set(widgets.map((w) => w.dataSourceId).filter((v): v is string => !!v))]
  if (sourceIds.length === 0) return EMPTY

  const [alertRes, kpiRes] = await Promise.all([
    client
      .from('alerts')
      .select('id, data_source_id, metric_sql, status, enabled, last_checked_at, created_at')
      .eq('org_id', orgId)
      .in('data_source_id', sourceIds)
      .is('deleted_at', null),
    client
      .from('kpi_catalog')
      .select('key, description, evidence, applied')
      .eq('org_id', orgId)
      .in('data_source_id', sourceIds)
      .eq('status', 'accepted'),
  ])

  const alerts: AlertRef[] = ((alertRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    dataSourceId: String(r.data_source_id),
    metricSql: String(r.metric_sql ?? ''),
    status: r.status === 'firing' ? 'firing' : 'normal',
    enabled: r.enabled !== false,
    lastCheckedAt: (r.last_checked_at as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  }))

  const applied: AppliedRef[] = []
  const definitions: Record<string, WidgetKpiDefinition> = {}
  for (const row of (kpiRes.data ?? []) as Array<Record<string, unknown>>) {
    const a = (row.applied ?? null) as { widgetId?: string; alertId?: string } | null
    if (!a?.widgetId) continue
    if (a.alertId) applied.push({ widgetId: a.widgetId, alertId: a.alertId })
    definitions[a.widgetId] = {
      key: String(row.key ?? ''),
      description: (row.description as string | null) ?? null,
      evidence: Array.isArray(row.evidence) ? (row.evidence as WidgetKpiDefinition['evidence']) : [],
    }
  }

  let events: EventRef[] = []
  if (alerts.length > 0) {
    const { data } = await client
      .from('alert_events')
      .select('id, alert_id, kind, created_at')
      .in(
        'alert_id',
        alerts.map((a) => a.id),
      )
      .order('created_at', { ascending: false })
      .limit(EVENT_SCAN_LIMIT)
    events = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      alertId: String(r.alert_id),
      kind: String(r.kind ?? ''),
      createdAt: String(r.created_at ?? ''),
    }))
  }

  return { links: matchMonitorLinks(widgets, alerts, applied, events), definitions }
}
