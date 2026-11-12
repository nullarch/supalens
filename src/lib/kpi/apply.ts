/**
 * Auto-KPI one-shot apply (design: docs/auto-kpi-plan.md — the apply/one-shot section + guardrails).
 *
 * Turns a set of reviewed KPI proposals into live artifacts in ONE call: an idempotent "핵심 KPI"
 * dashboard (or a caller-chosen existing one), a saved_query + dashboard_widget per KPI (each
 * re-validated through the SAME buildWidgetSpec path the MCP tools use — proposal-time validation is
 * NOT trusted at apply time), and, when requested, an alert per KPI whose proposal carried an
 * alert_config (createAlert's validation replicated on the admin client).
 *
 * Callers (the apply BFF route now; MCP tools later) have ALREADY verified org membership, so this
 * lib uses the untyped service-role admin client throughout — no cookie / user-JWT client here. Every
 * write is per-item and continues on failure: a bad KPI (or a tripped plan cap) fails just its own
 * item; the ones that succeed still land. Only failure to ESTABLISH the dashboard throws (there is
 * nothing to attach to then).
 *
 * NOT `import 'server-only'` — mirrors the shared-runtime hygiene of the modules it builds on
 * (src/lib/query/*, src/lib/kpi/service.ts, src/lib/dashboards/build-widget.ts).
 */
import { assertReadOnly } from '@/lib/query'
import { withoutSample } from '@/lib/viz/spec'
import { buildWidgetSpec, defaultGridSize } from '@/lib/dashboards/build-widget'
import { enforceResourceLimit, planLimitFor } from '@/lib/plans/usage'
import { effectiveCheckInterval } from '@/lib/alerts/evaluate'
import { DEFAULT_ANOMALY_WINDOW, type MonitorCondition } from '@/lib/alerts/condition'
import { isMissingSchemaError } from '@/lib/activation/logic'
import { getPlanLimit } from '@/lib/plans/limits'
import { requireAdminClient } from '@/utils/supabase/admin'
import { listKpis, markApplied } from '@/lib/kpi/service'
import type { KpiCatalogRow, NoMonitorReason } from '@/lib/kpi/types'

type Admin = ReturnType<typeof requireAdminClient>
type ErrorKind = 'validation' | 'cap' | 'internal'

const CORE_KPI_SLUG = 'core-kpi'
/** Dashboard display name at creation, by the applier's locale (slug stays 'core-kpi'). */
const CORE_KPI_NAME: Record<string, string> = { ko: '핵심 KPI', ja: 'コアKPI', en: 'Core KPIs' }
const OPS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const
type AlertOp = (typeof OPS)[number]

export interface ApplyKpisArgs {
  orgId: string
  userId: string
  dataSourceId: string
  kpiIds: string[]
  /** absent | 'new' => the idempotent core-kpi dashboard; a real id => that existing dashboard. */
  dashboardId?: string
  withAlerts: boolean
  /** requester locale for cap error messages + the created dashboard's display name. */
  locale?: string
}

export interface ApplyItemResult {
  kpiId: string
  key: string
  ok: boolean
  widgetId?: string
  savedQueryId?: string
  alertId?: string
  error?: string
  errorKind?: ErrorKind
}

/** Why a selected KPI will produce a widget but no monitor. */
export type DashboardOnlyReason = NoMonitorReason | 'alerts_off' | 'legacy_no_config'

/**
 * What "Approve & monitor" would actually do, computed BEFORE anything is written.
 * The review screen shows this so "7 approved" is never mistaken for "7 monitored" and a
 * plan cap is announced instead of discovered halfway through the apply.
 */
export interface ApplyPlan {
  /** Selectable, not-yet-applied KPIs in the request. */
  selected: number
  /** Of those, how many would get a live monitor (after cap simulation). */
  monitorsToCreate: number
  dashboardOnly: Array<{ kpiId: string; key: string; title: string; reason: DashboardOnlyReason }>
  capBlocked: Array<{ kpiId: string; key: string; title: string; cap: 'alerts_per_org' | 'widgets_per_dashboard' }>
  /** Already-accepted ids in the request — applying them again is a no-op. */
  alreadyApplied: number
  /** Effective evaluation interval for this org's plan, floored to the cron period. */
  cadenceSeconds: number
  /** The plan's monitor cap, or null when uncapped (billing inactive / unlimited plan). */
  alertLimit: number | null
}

export interface ApplyKpisResult {
  ok: boolean
  dashboardId: string
  dashboardSlug: string
  applied: number
  failed: number
  items: ApplyItemResult[]
  /** Same shape the dry run returns, so the result card reports monitors/cadence honestly. */
  plan: ApplyPlan
}

/** The org's plan tier, read straight from the row (usage.ts keeps its own copy private). */
async function orgPlan(admin: Admin, orgId: string): Promise<string> {
  const { data } = await admin.from('organizations').select('plan').eq('id', orgId).limit(1)
  return (data?.[0] as { plan: string | null } | undefined)?.plan ?? 'free'
}

/**
 * Importance-first order (5 → 1), stable within a tier by the caller's order. When a plan cap
 * truncates the run, the KPIs that matter most are the ones that land.
 */
function byImportance(rows: KpiCatalogRow[]): KpiCatalogRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.importance - a.r.importance || a.i - b.i)
    .map((x) => x.r)
}

/** The rows a request actually acts on, in apply order, plus the ids it will skip. */
function partitionRequest(
  catalog: KpiCatalogRow[],
  kpiIds: string[],
  orgId: string,
): { actionable: KpiCatalogRow[]; alreadyApplied: number } {
  const byId = new Map(catalog.map((r) => [r.id, r]))
  const seen = new Set<string>()
  const actionable: KpiCatalogRow[] = []
  let alreadyApplied = 0
  for (const id of kpiIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const row = byId.get(id)
    if (!row || row.orgId !== orgId || row.status === 'dismissed') continue
    if (row.status === 'accepted') {
      alreadyApplied += 1
      continue
    }
    actionable.push(row)
  }
  return { actionable: byImportance(actionable), alreadyApplied }
}

/**
 * Dry run: simulate the whole apply against the plan caps without writing anything.
 *
 * Cap simulation counts CURRENT rows once and then walks the (importance-ordered) selection,
 * decrementing headroom — the same order and the same caps the real apply enforces per item, so
 * the warning names the KPIs that will genuinely be skipped. `planLimitFor` returns null when
 * billing is inactive or the plan is unlimited, which makes every cap check a no-op here exactly
 * as `enforceResourceLimit` fails open there.
 */
export async function planKpiApply(args: ApplyKpisArgs): Promise<ApplyPlan> {
  const admin = requireAdminClient()
  const catalog = await listKpis(args.dataSourceId)
  const { actionable, alreadyApplied } = partitionRequest(catalog, args.kpiIds, args.orgId)

  // The dashboard is found, never created, in a dry run.
  const { data: dashRows } = await admin
    .from('dashboards')
    .select('id')
    .eq('org_id', args.orgId)
    .eq(args.dashboardId && args.dashboardId !== 'new' ? 'id' : 'slug', args.dashboardId && args.dashboardId !== 'new' ? args.dashboardId : CORE_KPI_SLUG)
    .is('deleted_at', null)
    .limit(1)
  const dashboardId = (dashRows?.[0] as { id: string } | undefined)?.id ?? null

  const [alertLimit, widgetLimit, plan] = await Promise.all([
    planLimitFor(args.orgId, 'alerts_per_org'),
    planLimitFor(args.orgId, 'widgets_per_dashboard'),
    orgPlan(admin, args.orgId),
  ])

  const [{ count: alertCount }, { count: widgetCount }] = await Promise.all([
    admin.from('alerts').select('*', { count: 'exact', head: true }).eq('org_id', args.orgId).is('deleted_at', null),
    dashboardId
      ? admin
          .from('dashboard_widgets')
          .select('*', { count: 'exact', head: true })
          .eq('dashboard_id', dashboardId)
          .is('deleted_at', null)
      : Promise.resolve({ count: 0 }),
  ])

  let alertHeadroom = alertLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, alertLimit - (alertCount ?? 0))
  let widgetHeadroom = widgetLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, widgetLimit - (widgetCount ?? 0))

  const dashboardOnly: ApplyPlan['dashboardOnly'] = []
  const capBlocked: ApplyPlan['capBlocked'] = []
  let monitorsToCreate = 0

  for (const row of actionable) {
    // The widget cap gates the whole item (the real apply skips it before any write).
    if (widgetHeadroom <= 0) {
      capBlocked.push({ kpiId: row.id, key: row.key, title: row.title, cap: 'widgets_per_dashboard' })
      continue
    }
    widgetHeadroom -= 1

    if (!args.withAlerts) {
      dashboardOnly.push({ kpiId: row.id, key: row.key, title: row.title, reason: 'alerts_off' })
      continue
    }
    if (!row.alertConfig) {
      dashboardOnly.push({
        kpiId: row.id,
        key: row.key,
        title: row.title,
        reason: row.noMonitor?.reason ?? 'legacy_no_config',
      })
      continue
    }
    if (alertHeadroom <= 0) {
      // The widget still lands; only the monitor is blocked — same as the real apply's soft note.
      capBlocked.push({ kpiId: row.id, key: row.key, title: row.title, cap: 'alerts_per_org' })
      continue
    }
    alertHeadroom -= 1
    monitorsToCreate += 1
  }

  return {
    selected: actionable.length,
    monitorsToCreate,
    dashboardOnly,
    capBlocked,
    alreadyApplied,
    cadenceSeconds: effectiveCheckInterval(getPlanLimit(plan, 'alert_min_check_interval')),
    alertLimit,
  }
}

/**
 * Find-or-create the target dashboard. Throws when it cannot be established:
 *   - a real dashboardId that is not in this org  -> 'dashboard_not_in_org'
 *   - creating the core-kpi dashboard but the plan's dashboard cap is reached -> the cap message
 * The dashboards cap is checked ONLY on create (an existing / found dashboard never re-caps).
 */
export async function resolveDashboard(
  admin: Admin,
  args: Pick<ApplyKpisArgs, 'orgId' | 'dashboardId' | 'locale'> & { userId?: string | null }
): Promise<{ id: string; slug: string; orgId: string }> {
  // A real dashboard id: it MUST belong to this org (never create; never cap).
  if (args.dashboardId && args.dashboardId !== 'new') {
    const { data } = await admin
      .from('dashboards')
      .select('id, slug, org_id')
      .eq('id', args.dashboardId)
      .eq('org_id', args.orgId)
      .is('deleted_at', null)
      .limit(1)
    const row = data?.[0] as { id: string; slug: string; org_id: string } | undefined
    if (!row) throw new Error('dashboard_not_in_org')
    return { id: row.id, slug: row.slug, orgId: row.org_id }
  }

  // Idempotent core-kpi dashboard: find by (org, slug) — like MCP create_dashboard's slug upsert.
  const { data: existing } = await admin
    .from('dashboards')
    .select('id, slug, org_id')
    .eq('org_id', args.orgId)
    .eq('slug', CORE_KPI_SLUG)
    .is('deleted_at', null)
    .limit(1)
  const found = existing?.[0] as { id: string; slug: string; org_id: string } | undefined
  if (found) return { id: found.id, slug: found.slug, orgId: found.org_id }

  // Creating a NEW dashboard -> the dashboards cap applies here ONLY (opts copied from createDashboard).
  const cap = await enforceResourceLimit(args.orgId, 'dashboards', {
    table: 'dashboards',
    label: 'dashboard',
    locale: args.locale,
    softDelete: true,
    filters: [{ column: 'org_id', value: args.orgId }],
  })
  if (!cap.ok) throw new Error(cap.error)

  // pinned true per design: the core-KPI board sorts to the top of /app/dashboards + the sidebar.
  const { data: ins, error } = await admin
    .from('dashboards')
    .insert({
      org_id: args.orgId,
      slug: CORE_KPI_SLUG,
      name: CORE_KPI_NAME[args.locale ?? ''] ?? CORE_KPI_NAME.en,
      created_by: args.userId ?? null,
      pinned: true,
    })
    .select('id, slug, org_id')
    .limit(1)
  const row = ins?.[0] as { id: string; slug: string; org_id: string } | undefined
  if (error || !row) throw new Error(`failed to create dashboard: ${error?.message ?? 'unknown'}`)
  return { id: row.id, slug: row.slug, orgId: row.org_id }
}

/**
 * Create an alert for an applied KPI, replicating createAlert's validation (assertReadOnly +
 * threshold/anomaly rules + fire_threshold/cooldown defaults) on the admin client. Returns the new
 * alert id, or an { error, errorKind } the caller notes on the item WITHOUT undoing the widget.
 */
async function createKpiAlert(
  admin: Admin,
  args: ApplyKpisArgs,
  row: KpiCatalogRow
): Promise<{ id: string } | { error: string; errorKind: ErrorKind }> {
  const cfg = row.alertConfig
  if (!cfg) return { error: 'no alert config', errorKind: 'validation' }

  // metric SQL must be a single read-only SELECT (same guard as createAlert).
  try {
    assertReadOnly(row.metricSql)
  } catch (e) {
    return { error: `alert skipped (metric SQL not read-only): ${e instanceof Error ? e.message : String(e)}`, errorKind: 'validation' }
  }

  // Anomaly alerts carry no user threshold — operator/threshold are unused placeholders and the
  // z-score cutoff lives in `sensitivity`. Threshold alerts validate operator + threshold as before.
  const isAnomaly = cfg.type === 'anomaly'
  let operator: AlertOp = 'gt'
  let threshold = 0
  let sensitivity: number | null = null
  if (isAnomaly) {
    sensitivity = Number.isFinite(cfg.sensitivity) ? (cfg.sensitivity as number) : 3
  } else {
    if (!cfg.operator || !OPS.includes(cfg.operator)) return { error: 'alert skipped (invalid operator)', errorKind: 'validation' }
    if (cfg.threshold === undefined || !Number.isFinite(cfg.threshold)) {
      return { error: 'alert skipped (threshold not a number)', errorKind: 'validation' }
    }
    operator = cfg.operator
    threshold = cfg.threshold
  }

  const cap = await enforceResourceLimit(args.orgId, 'alerts_per_org', {
    table: 'alerts',
    label: 'alert',
    locale: args.locale,
    softDelete: true,
    filters: [{ column: 'org_id', value: args.orgId }],
  })
  if (!cap.ok) return { error: cap.error, errorKind: 'cap' }

  // An anomaly KPI becomes a goal-monitor condition: direction-aware, judged against a bounded
  // trailing window, with the day still in progress skipped (condition.ts) — the legacy anomaly
  // path compared a half-finished today against the whole history. The legacy columns are still
  // written (legacyColumnsFor ≡ the values above) for older readers.
  const condition: MonitorCondition | null = isAnomaly
    ? { v: 1, strategy: 'anomaly', direction: cfg.direction ?? 'both', sensitivity: sensitivity ?? 3, window: DEFAULT_ANOMALY_WINDOW }
    : null
  const row0 = {
    org_id: args.orgId,
    data_source_id: args.dataSourceId,
    name: row.title,
    description: null,
    type: cfg.type,
    metric_sql: row.metricSql,
    operator,
    threshold,
    sensitivity,
    fire_threshold: 1,
    cooldown_seconds: 3600,
    enabled: true,
    created_by: args.userId,
  }
  let { data, error } = await admin
    .from('alerts')
    .insert(condition ? { ...row0, condition } : row0)
    .select('id')
    .limit(1)
  // before the goal-monitor migration the column doesn't exist — keep the legacy anomaly row
  if (error && condition && isMissingSchemaError(error)) {
    ;({ data, error } = await admin.from('alerts').insert(row0).select('id').limit(1))
  }
  if (error || !data?.[0]) return { error: `alert insert failed: ${error?.message ?? 'unknown'}`, errorKind: 'internal' }
  return { id: (data[0] as { id: string }).id }
}

/**
 * The one-shot apply. Establishes the dashboard, then for each requested KPI: re-validates the SQL +
 * chart, writes a saved_query (with `source` provenance = evidence) and a dashboard_widget, optionally
 * an alert, and stamps the catalog row `accepted`. Continues on per-item failure; `ok = failed === 0`.
 */
export async function applyKpis(args: ApplyKpisArgs): Promise<ApplyKpisResult> {
  const admin = requireAdminClient()

  // 0) The same dry run the review screen showed, recomputed here so the RESULT can report
  //    monitors/cadence from one source of truth (and so a cap tripped between preview and
  //    submit still shows up in the response).
  const plan = await planKpiApply(args)

  // 1) Load the catalog for this source and index by id. Requested ids are de-duplicated (applying
  //    the same KPI twice would create duplicate widgets) and ordered importance-first, so a plan
  //    cap truncates the tail rather than whatever the client happened to send last.
  const catalog = await listKpis(args.dataSourceId)
  const byId = new Map<string, KpiCatalogRow>(catalog.map((r) => [r.id, r]))
  const ordered = partitionRequest(catalog, args.kpiIds, args.orgId).actionable.map((r) => r.id)
  const rest = [...new Set(args.kpiIds)].filter((id) => !ordered.includes(id))
  const requestedIds = [...ordered, ...rest]

  // 2) Establish the dashboard FIRST — throws if it can't be created (nothing to attach to then).
  const dashboard = await resolveDashboard(admin, args)

  // Widget position: append after existing widgets (copied from addWidgetToDashboard's nextPos logic).
  const { data: posRows } = await admin
    .from('dashboard_widgets')
    .select('position')
    .eq('dashboard_id', dashboard.id)
    .order('position', { ascending: false })
    .limit(1)
  let nextPos = ((posRows?.[0] as { position?: number } | undefined)?.position ?? -1) + 1

  const items: ApplyItemResult[] = []

  for (const kpiId of requestedIds) {
    const row = byId.get(kpiId)
    // pre-check: the id must exist, belong to this org, and not be dismissed.
    if (!row) {
      items.push({ kpiId, key: '', ok: false, error: 'KPI not found for this data source', errorKind: 'validation' })
      continue
    }
    if (row.orgId !== args.orgId) {
      items.push({ kpiId, key: row.key, ok: false, error: 'KPI belongs to another organization', errorKind: 'validation' })
      continue
    }
    if (row.status === 'dismissed') {
      items.push({ kpiId, key: row.key, ok: false, error: 'KPI is dismissed', errorKind: 'validation' })
      continue
    }
    if (row.status === 'accepted') {
      // Already applied — idempotent no-op. Re-applying (e.g. an API/MCP call with a set that
      // overlaps a prior apply) must NOT create a second widget/saved_query; markApplied would then
      // also overwrite `applied`, orphaning the first widget's tracking. Report the existing ids.
      items.push({
        kpiId,
        key: row.key,
        ok: true,
        widgetId: row.applied?.widgetId,
        savedQueryId: row.applied?.savedQueryId,
        alertId: row.applied?.alertId,
      })
      continue
    }

    // 3a–3d) The draft board Supalens made right after extraction may already hold this KPI as a
    //     widget (src/lib/kpi/draft-board.ts). Approving it ADOPTS that widget — same saved_query,
    //     same place on the board — instead of adding a duplicate next to it.
    let widgetId: string
    let savedQueryId: string
    const draft = await findDraftWidget(admin, dashboard.id, args.dataSourceId, row.key)
    if (draft) {
      ;({ widgetId, savedQueryId } = draft)
      await admin
        .from('saved_queries')
        .update({ source: { kind: 'auto_kpi', evidence: row.evidence, key: row.key } })
        .eq('id', savedQueryId)
    } else {
      const created = await createKpiWidget(
        admin,
        { orgId: args.orgId, dataSourceId: args.dataSourceId, userId: args.userId, locale: args.locale },
        dashboard,
        row,
        nextPos,
      )
      if (!created.ok) {
        items.push({ kpiId, key: row.key, ok: false, error: created.error, errorKind: created.errorKind })
        continue
      }
      ;({ widgetId, savedQueryId } = created)
      nextPos += 1
    }

    // 3e) optional alert — a failure here does NOT undo the widget (soft-note on an otherwise-ok item).
    let alertId: string | undefined
    let note: { error: string; errorKind: ErrorKind } | undefined
    if (args.withAlerts && row.alertConfig) {
      const res = await createKpiAlert(admin, args, row)
      if ('id' in res) alertId = res.id
      else note = res
    }

    // 3f) stamp the catalog row applied (status -> accepted; artifacts recorded). The artifacts DID
    //     land, so a failed stamp is a soft note, not an item failure.
    try {
      await markApplied(row.id, { dashboardId: dashboard.id, widgetId, savedQueryId, alertId })
    } catch (e) {
      note = note ?? { error: `applied-stamp failed: ${String(e instanceof Error ? e.message : e)}`, errorKind: 'internal' }
    }

    items.push({
      kpiId,
      key: row.key,
      ok: true,
      widgetId,
      savedQueryId,
      alertId,
      ...(note ? { error: note.error, errorKind: note.errorKind } : {}),
    })
  }

  const applied = items.filter((i) => i.ok).length
  const failed = items.length - applied
  return {
    ok: failed === 0,
    dashboardId: dashboard.id,
    dashboardSlug: dashboard.slug,
    applied,
    failed,
    items,
    // Report what actually landed, not the pre-flight estimate — the counts can differ when a cap
    // was consumed between preview and submit.
    plan: { ...plan, monitorsToCreate: items.filter((i) => i.ok && i.alertId).length },
  }
}

export interface KpiWidgetContext {
  orgId: string
  dataSourceId: string
  /** The approving user; null for the system-drafted board (no human actor). */
  userId?: string | null
  locale?: string
}

/**
 * Build + insert ONE KPI widget onto a board: re-validate its SQL and chart through the shared
 * widget path (proposal-time validation is NOT trusted), check the per-board widget cap BEFORE any
 * write, then saved_query + dashboard_widget. Shared by the approval apply and the draft board.
 * `draft` marks the saved_query's provenance so the approval can adopt it later.
 */
export async function createKpiWidget(
  admin: Admin,
  ctx: KpiWidgetContext,
  dashboard: { id: string; orgId: string },
  row: KpiCatalogRow,
  position: number,
  opts: { draft?: boolean } = {},
): Promise<{ ok: true; widgetId: string; savedQueryId: string } | { ok: false; error: string; errorKind: ErrorKind }> {
  let built: Awaited<ReturnType<typeof buildWidgetSpec>>
  try {
    const actor = ctx.userId ? { kind: 'user' as const, id: ctx.userId } : { kind: 'system' as const }
    built = await buildWidgetSpec(ctx.dataSourceId, actor, row.metricSql, row.vizSpec.chart)
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: 'validation' }
  }

  const wcap = await enforceResourceLimit(ctx.orgId, 'widgets_per_dashboard', {
    table: 'dashboard_widgets',
    label: 'widget',
    locale: ctx.locale,
    softDelete: true,
    filters: [{ column: 'dashboard_id', value: dashboard.id }],
  })
  if (!wcap.ok) return { ok: false, error: wcap.error, errorKind: 'cap' }

  // `source` provenance carries the KPI evidence + key (grounds the widget in code/tables).
  const { data: sq, error: sqErr } = await admin
    .from('saved_queries')
    .insert({
      org_id: dashboard.orgId,
      data_source_id: ctx.dataSourceId,
      name: row.title,
      sql: row.metricSql,
      created_by: ctx.userId ?? null,
      source: { kind: 'auto_kpi', evidence: row.evidence, key: row.key, ...(opts.draft ? { draft: true } : {}) },
    })
    .select('id')
    .limit(1)
  if (sqErr || !sq?.[0]) return { ok: false, error: `saved query insert failed: ${sqErr?.message ?? 'unknown'}`, errorKind: 'internal' }
  const savedQueryId = (sq[0] as { id: string }).id

  const { data: widget, error: wErr } = await admin
    .from('dashboard_widgets')
    .insert({
      dashboard_id: dashboard.id,
      org_id: dashboard.orgId,
      saved_query_id: savedQueryId,
      data_source_id: ctx.dataSourceId,
      spec: withoutSample(built.spec), // snapshot lives once, in the sample column
      sample: built.spec.sample ?? null,
      x: 0,
      y: 0,
      ...defaultGridSize(built.spec.chart),
      position,
    })
    .select('id')
    .limit(1)
  if (wErr || !widget?.[0]) {
    // Clean up the saved_query so a widget-insert fault doesn't orphan it.
    await admin.from('saved_queries').delete().eq('id', savedQueryId)
    return { ok: false, error: `widget insert failed: ${wErr?.message ?? 'unknown'}`, errorKind: 'internal' }
  }
  return { ok: true, widgetId: (widget[0] as { id: string }).id, savedQueryId }
}

/** A live widget on `dashboardId` built from this data source's KPI `key`, if one exists. */
export async function findDraftWidget(
  admin: Admin,
  dashboardId: string,
  dataSourceId: string,
  key: string,
): Promise<{ widgetId: string; savedQueryId: string } | null> {
  const { data: queries } = await admin
    .from('saved_queries')
    .select('id')
    .eq('data_source_id', dataSourceId)
    .eq('source->>key', key)
  const ids = ((queries ?? []) as { id: string }[]).map((q) => q.id)
  if (ids.length === 0) return null
  const { data: widgets } = await admin
    .from('dashboard_widgets')
    .select('id, saved_query_id')
    .eq('dashboard_id', dashboardId)
    .in('saved_query_id', ids)
    .is('deleted_at', null)
    .limit(1)
  const w = (widgets?.[0] as { id: string; saved_query_id: string } | undefined) ?? null
  return w ? { widgetId: w.id, savedQueryId: w.saved_query_id } : null
}
