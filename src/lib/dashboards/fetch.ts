import 'server-only'

import { createClient } from '@/utils/supabase/server'
import { migrateSpec, VisualizationSpec } from '@/lib/viz/spec'
import type { ChartSpec, WidgetData } from '@/lib/viz/spec'
import type { AppChrome, DashboardDetail, DashboardSummary, DashboardWidgetRecord } from './types'
import { runWidgetData } from './live'
import { getWidgetMonitorInfo, type WidgetRef } from './monitor-links'
import { resolveWidgetSource, sourceMarkOf, type WidgetSource } from './widget-source'
import { pickHomeDashboard } from './home-pick'
import { cookies } from 'next/headers'
import { listOrgs, ACTIVE_ORG_COOKIE } from '@/lib/org/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { entitledPlan, getPlanLimit } from '@/lib/plans/limits'

/**
 * Server-side reads for saved dashboards (RLS enforced via the user JWT).
 * When Supabase is unconfigured (local dev with no .env.local) `createClient()`
 * returns null; callers then fall back to the sample widgets / dummy sidebar list.
 */

/** The org whose dashboards should be shown: the ACTIVE_ORG_COOKIE if the user still belongs to it,
 *  else their first org. RLS admits dashboards from EVERY org the user is a member of, so without
 *  this scope a per-org constant slug (e.g. applyKpis' 'core-kpi') would resolve to an arbitrary
 *  org's board for a multi-org user. Returns null when the user has no orgs. */
export async function resolveActiveOrgId(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
): Promise<string | null> {
  const orgs = await listOrgs(supabase)
  if (orgs.length === 0) return null
  const cookieId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value
  if (cookieId && orgs.some((o) => o.id === cookieId)) return cookieId
  return orgs[0].id
}

interface WidgetRow {
  id: string
  spec: unknown
  sample: unknown
  x: number
  y: number
  w: number
  h: number
  position: number
  data_source_id: string | null
  saved_query_id: string | null
  refresh_interval: number | null
}

/** The re-runnable query inside a stored spec (VisualizationSpec envelope), if any — the SQL
 *  string plus an optional structured Firestore descriptor (for document-backed widgets). */
function queryOf(spec: VisualizationSpec | ChartSpec): VisualizationSpec['query'] | null {
  const env = VisualizationSpec.safeParse(spec)
  return env.success ? env.data.query : null
}

function toWidgetRecord(row: WidgetRow): DashboardWidgetRecord {
  // Validate as a full VisualizationSpec envelope; if it isn't one (a bare ChartSpec
  // demo widget), keep it as-is — WidgetRenderer accepts either.
  const envelope = migrateSpec(row.spec)
  const spec: VisualizationSpec | ChartSpec = envelope ?? (row.spec as ChartSpec)
  const sample = row.sample && typeof row.sample === 'object' ? (row.sample as WidgetData) : null
  return {
    id: row.id,
    spec,
    sample,
    layout: { x: row.x, y: row.y, w: row.w, h: row.h },
    position: row.position,
    dataSourceId: row.data_source_id,
    savedQueryId: row.saved_query_id,
    refreshInterval: row.refresh_interval,
  }
}

export async function listDashboards(): Promise<DashboardSummary[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const orgId = await resolveActiveOrgId(supabase)
  if (!orgId) return []
  const { data, error } = await supabase
    .from('dashboards')
    .select('id, slug, name, pinned, position')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
  if (error || !data) return []
  return data as DashboardSummary[]
}

export async function getDashboardBySlug(slug: string): Promise<DashboardDetail | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const orgId = await resolveActiveOrgId(supabase)
  if (!orgId) return null

  const { data: dashRows } = await supabase
    .from('dashboards')
    .select('id, slug, name, pinned, position')
    .eq('org_id', orgId) // scope to the active org — the slug can collide across the user's orgs
    .eq('slug', slug)
    .is('deleted_at', null)
    .limit(1)
  const dash = dashRows?.[0] as DashboardSummary | undefined
  if (!dash) return null

  const widgetSelect = () =>
    supabase
      .from('dashboard_widgets')
      .select('id, spec, sample, x, y, w, h, position, data_source_id, saved_query_id, refresh_interval')
      .eq('dashboard_id', dash.id)
      .order('position', { ascending: true })

  const filtered = await widgetSelect().is('deleted_at', null)
  let rows = filtered.data
  if (filtered.error) {
    // deploy-before-migration: deleted_at may not exist yet (20260709090000) — degrade to the
    // unfiltered read instead of rendering an empty board (same convention as checkUsageQuota)
    ;({ data: rows } = await widgetSelect())
  }

  const rowList = (rows ?? []) as WidgetRow[]
  const widgets = rowList.map(toWidgetRecord)

  // Widgets with a connected data source re-run their query LIVE on every view (cached per
  // widget via unstable_cache; refresh_interval / 60s revalidate). The stored `sample` is a
  // creation-time snapshot used as a FALLBACK when the re-run fails — never instead of live
  // data (that made every dashboard a frozen snapshot). No data source (legacy ask-added
  // widgets) → the snapshot is all there is.
  // Which service each widget reads from — a board mixes every source in the workspace, so each
  // card names its own. Best-effort: an unreadable source leaves the card without the line.
  const sourceIds = [...new Set(widgets.map((w) => w.dataSourceId).filter((id): id is string => !!id))]
  const sourcesRead: Promise<Map<string, WidgetSource> | null> =
    sourceIds.length === 0
      ? Promise.resolve(new Map())
      : Promise.resolve(
          supabase.from('data_sources').select('id, name, engine, provider').in('id', sourceIds),
        ).then(
          ({ data, error }) =>
            error || !data
              ? null
              : new Map(
                  (data as { id: string; name: string; engine: string; provider: string | null }[]).map((row) => [
                    row.id,
                    { id: row.id, name: row.name, engine: sourceMarkOf(row) },
                  ]),
                ),
          () => null,
        )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    await Promise.all(
      widgets.map(async (w, i) => {
        if (!w.dataSourceId) return
        const q = queryOf(w.spec)
        if (!q) return
        const live = await runWidgetData(w.id, w.dataSourceId, q, user.id, rowList[i]?.refresh_interval ?? null)
        if (live) {
          w.sample = live
        } else if (!w.sample) {
          w.liveError = true // re-run failed and there is no snapshot → visible error, not fake-empty
        }
      })
    )
  }

  const sources = await sourcesRead
  for (const w of widgets) w.source = resolveWidgetSource(w.dataSourceId, sources)

  // Monitoring context: which widgets a monitor is watching, and the verified KPI definition
  // behind the auto-KPI ones. A report is the operator's view of approved KPIs, so a chart
  // whose metric is being watched says so. Best-effort — never blocks the board.
  const refs: WidgetRef[] = widgets.map((w) => {
    const q = queryOf(w.spec)
    // A Firestore widget's `query.sql` is a display descriptor, not a runnable query, and
    // monitors are SQL-only — so it must never take part in SQL-identity matching.
    return { id: w.id, dataSourceId: w.dataSourceId, sql: q && !q.firestore ? (q.sql ?? null) : null }
  })
  const info = await getWidgetMonitorInfo(supabase, orgId, refs).catch(() => null)
  if (info) {
    for (const w of widgets) {
      w.monitor = info.links[w.id] ?? null
      w.definition = info.definitions[w.id] ?? null
    }
  }

  return { ...dash, widgets }
}

function initials(s: string): string {
  const t = (s || '').trim()
  if (!t) return '?'
  const words = t.split(/\s+/)
  if (/^[\x00-\x7F]+$/.test(t) && words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return t.slice(0, 2).toUpperCase()
}

/** Sidebar/Topbar data: the user's dashboards + current user + current org (RLS). */
export async function getAppChrome(): Promise<AppChrome> {
  const supabase = await createClient()
  if (!supabase) return { dashboards: [], user: null, org: null, orgs: [], billing: null, monitors: null }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { dashboards: [], user: null, org: null, orgs: [], billing: null, monitors: null }

  const { data: profRows } = await supabase.from('profiles').select('display_name, email').eq('id', user.id).limit(1)
  const prof = profRows?.[0] as { display_name?: string | null; email?: string | null } | undefined
  const name = prof?.display_name || user.email?.split('@')[0] || '사용자'
  const email = prof?.email || user.email || ''

  // Platform-staff flag. Read via the untyped admin client (own row) so it works before
  // db:types regenerates schema.type.ts with the new profiles.is_admin column — same reason
  // the billing columns below are read via admin.
  let isAdmin = false
  {
    const admin = createAdminClient()
    if (admin) {
      const { data: adminRows } = await admin.from('profiles').select('is_admin').eq('id', user.id).limit(1)
      isAdmin = (adminRows?.[0] as { is_admin?: boolean } | undefined)?.is_admin === true
    }
  }

  const orgRows = await listOrgs(supabase)
  const orgs = orgRows.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    initials: initials(o.name),
    role: o.role,
  }))
  const activeId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value
  const current = (activeId ? orgs.find((o) => o.id === activeId) : null) ?? orgs[0] ?? null

  // Sidebar dashboards — scoped to the ACTIVE org (RLS admits every org the user belongs to, so an
  // unscoped list would mix a multi-org user's boards together).
  let dashboards: DashboardSummary[] = []
  let homeDashboardId: string | null = null
  if (current) {
    const [{ data: dashRows }, { data: orgHome, error: homeError }] = await Promise.all([
      supabase
        .from('dashboards')
        .select('id, slug, name, pinned, position')
        .eq('org_id', current.id)
        .is('deleted_at', null)
        .order('position', { ascending: true }),
      // the chosen home board — best-effort (the column may predate its migration); the chrome
      // only uses it to mark a row, so any read fault falls back to the default rule
      supabase.from('organizations').select('home_dashboard_id').eq('id', current.id).limit(1),
    ])
    dashboards = (dashRows ?? []) as DashboardSummary[]
    const chosenId = homeError ? null : ((orgHome?.[0] as { home_dashboard_id?: string | null } | undefined)?.home_dashboard_id ?? null)
    homeDashboardId = pickHomeDashboard(dashboards, chosenId)?.id ?? null
  }

  // billing summary for the sidebar meter. Read via the untyped admin client so it works
  // before db:types regenerates the new billing columns (members may read their org's plan).
  // The meter's value unit is MONITORS (alerts vs alerts_per_org) — the product is
  // monitoring, so the sidebar counts what the plan actually caps for that; query usage
  // still rides along for the billing page.
  let billing: AppChrome['billing'] = null
  let monitors: AppChrome['monitors'] = null
  if (current) {
    const admin = createAdminClient()
    if (admin) {
      const [{ data: bRows }, monitorsTotal, monitorsEnabled] = await Promise.all([
        admin
          .from('organizations')
          .select('plan, subscription_status, current_period_query_count')
          .eq('id', current.id)
          .limit(1),
        admin.from('alerts').select('*', { count: 'exact', head: true }).eq('org_id', current.id).is('deleted_at', null),
        admin
          .from('alerts')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', current.id)
          .is('deleted_at', null)
          .eq('enabled', true),
      ])
      const b = bRows?.[0] as
        | { plan: string | null; subscription_status: string | null; current_period_query_count: number | null }
        | undefined
      if (b) {
        // entitled (not raw) plan — the sidebar meter must show the limit enforcement applies
        const plan = entitledPlan(b.plan, b.subscription_status)
        billing = {
          plan,
          queriesUsed: b.current_period_query_count ?? 0,
          queriesLimit: getPlanLimit(plan, 'queries_per_month'),
          monitorsUsed: monitorsTotal.count ?? 0,
          monitorsLimit: getPlanLimit(plan, 'alerts_per_org'),
        }
      }
      monitors = { enabled: monitorsEnabled.count ?? 0 }
    }
  }

  return {
    dashboards,
    homeDashboardId,
    user: { name, email, initials: initials(name), isAdmin },
    org: current ? { id: current.id, name: current.name, initials: current.initials } : null,
    orgs,
    billing,
    monitors,
  }
}
