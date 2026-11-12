'use server'

import { revalidatePath } from 'next/cache'
import { getLocale, getTranslations } from 'next-intl/server'
import { createClient } from '@/utils/supabase/server'
import { migrateSpec, withoutSample } from '@/lib/viz/spec'
import { defaultGridSize } from './build-widget'
import { enforceResourceLimit } from '@/lib/plans/usage'
import { listDashboards, resolveActiveOrgId } from './fetch'
import type { ActionResult, DashboardSummary, WidgetLayoutPatch } from './types'

/** Picker list for client UI (the ask → 위젯 추가 bridge). [] when unconfigured. */
export async function listDashboardsForPicker(): Promise<DashboardSummary[]> {
  return listDashboards()
}

/**
 * Mutations for saved dashboards. They use the user-JWT server client so RLS is
 * enforced (member+ write, own-org only). When Supabase is unconfigured they return
 * { ok:false, reason:'unconfigured' } and the caller keeps its local fallback.
 */

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // Korean / non-ascii names slugify to empty → always add a short unique suffix
  return `${base || 'dash'}-${Date.now().toString(36).slice(-4)}`
}

/** Persist grid placement for one or more widgets (resize / drag-reorder). */
export async function saveDashboardLayout(items: WidgetLayoutPatch[]): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  for (const it of items) {
    const { error } = await supabase
      .from('dashboard_widgets')
      .update({ x: it.x, y: it.y, w: it.w, h: it.h, position: it.position })
      .eq('id', it.id)
    if (error) return { ok: false, reason: 'error', message: error.message }
  }
  revalidatePath('/app/dashboards')
  return { ok: true, data: undefined }
}

/**
 * Make a board the workspace's HOME dashboard — the one /app/overview shows — or pass `null` to go
 * back to Automatic (the AI-drafted core-KPI board, else the first favorite, else the first board).
 * Owner/admin only: the write goes through the org_write RLS policy, so a member's update matches
 * no row and is reported as not allowed (never a silent success). A board must be a live board of
 * the active workspace.
 */
export async function setHomeDashboard(id: string | null): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const t = await getTranslations('appDashboards')
  const orgId = await resolveActiveOrgId(supabase)
  if (!orgId) return { ok: false, reason: 'unauthorized' }
  if (id !== null) {
    const { data: board } = await supabase
      .from('dashboards')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .limit(1)
    if (!board?.[0]) return { ok: false, reason: 'not_found' }
  }
  const { data, error } = await supabase
    .from('organizations')
    .update({ home_dashboard_id: id })
    .eq('id', orgId)
    .select('id')
  if (error) {
    const pending = error.code === '42703'
    return { ok: false, reason: 'error', message: pending ? t('home.migrationPending') : error.message }
  }
  if (!data?.length) return { ok: false, reason: 'error', message: t('home.adminOnly') }
  revalidatePath('/app/overview')
  revalidatePath('/app/dashboards')
  return { ok: true, data: undefined }
}

/** Toggle a dashboard's pinned (즐겨찾기) flag. */
export async function toggleDashboardPin(id: string, pinned: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const { error } = await supabase.from('dashboards').update({ pinned }).eq('id', id)
  if (error) return { ok: false, reason: 'error', message: error.message }
  revalidatePath('/app')
  return { ok: true, data: undefined }
}

/** Save an agent-proposed visualization onto a dashboard (the ask → 위젯 추가 bridge). */
export async function addWidgetToDashboard(
  dashboardId: string,
  widget: { spec: unknown; sample?: unknown; dataSourceId?: string | null }
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }

  const parsed = migrateSpec(widget.spec)
  if (!parsed) return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('invalidSpec') }

  // org_id comes from the (RLS-checked) dashboard, never the client
  const { data: dashRows } = await supabase
    .from('dashboards')
    .select('id, org_id')
    .eq('id', dashboardId)
    .is('deleted_at', null) // a deleted dashboard must not accept new widgets
    .limit(1)
  const dash = dashRows?.[0] as { id: string; org_id: string } | undefined
  if (!dash) return { ok: false, reason: 'not_found' }

  // The data source id is CLIENT input, and dashboard reads later resolve vault credentials from
  // it alone (runWidgetData → executeReadOnly → resolveDataSource) — so bind it to the dashboard's
  // org HERE or a member of org A could point a widget at org B's source UUID and query B's DB.
  if (widget.dataSourceId) {
    const { data: dsRows } = await supabase
      .from('data_sources')
      .select('id, org_id')
      .eq('id', widget.dataSourceId)
      .is('deleted_at', null)
      .limit(1)
    const ds = dsRows?.[0] as { org_id: string } | undefined
    if (!ds || ds.org_id !== dash.org_id) {
      return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('sourceNotFound') }
    }
  }

  const cap = await enforceResourceLimit(dash.org_id, 'widgets_per_dashboard', {
    table: 'dashboard_widgets',
    label: 'widget',
    locale: await getLocale(),
    softDelete: true,
    filters: [{ column: 'dashboard_id', value: dashboardId }],
  })
  if (!cap.ok) return { ok: false, reason: 'error', message: cap.error }

  const { data: posRows } = await supabase
    .from('dashboard_widgets')
    .select('position')
    .eq('dashboard_id', dashboardId)
    .is('deleted_at', null) // removed widgets must not inflate the next position
    .order('position', { ascending: false })
    .limit(1)
  const nextPos = ((posRows?.[0] as { position?: number } | undefined)?.position ?? -1) + 1

  const { data: ins, error } = await supabase
    .from('dashboard_widgets')
    .insert({
      dashboard_id: dashboardId,
      org_id: dash.org_id,
      // envelope minus its inline sample — the snapshot lives once, in the `sample` column
      spec: withoutSample(parsed),
      sample: widget.sample ?? parsed.sample ?? null,
      data_source_id: widget.dataSourceId ?? null,
      x: 0,
      y: 0,
      ...defaultGridSize(parsed.chart),
      position: nextPos,
    })
    .select('id')
    .limit(1)
  if (error) return { ok: false, reason: 'error', message: error.message }

  revalidatePath('/app/dashboards')
  return { ok: true, data: { id: (ins?.[0] as { id: string } | undefined)?.id ?? '' } }
}

/** Create a new (empty) dashboard in the user's organization. */
export async function createDashboard(name: string): Promise<ActionResult<{ id: string; slug: string }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }

  // The ACTIVE org (cookie-aware, like every other org-scoped surface) — an unordered
  // `organization_members LIMIT 1` put a multi-org user's new dashboard in an arbitrary org,
  // where the sidebar (scoped to the active org) never shows it.
  const orgId = await resolveActiveOrgId(supabase)
  if (!orgId) return { ok: false, reason: 'not_found', message: (await getTranslations('dashActions'))('noOrg') }

  const cap = await enforceResourceLimit(orgId, 'dashboards', {
    table: 'dashboards',
    label: 'dashboard',
    locale: await getLocale(),
    softDelete: true,
    filters: [{ column: 'org_id', value: orgId }],
  })
  if (!cap.ok) return { ok: false, reason: 'error', message: cap.error }

  const slug = slugify(name)
  const { data: ins, error } = await supabase
    .from('dashboards')
    .insert({ org_id: orgId, name, slug, created_by: user.id })
    .select('id, slug')
    .limit(1)
  if (error) return { ok: false, reason: 'error', message: error.message }

  revalidatePath('/app')
  const row = ins?.[0] as { id: string; slug: string } | undefined
  return { ok: true, data: { id: row?.id ?? '', slug: row?.slug ?? slug } }
}

/** Soft-delete a dashboard (RLS member+). Fixes the "create 1 board on free → stuck forever" dead-end. */
export async function deleteDashboard(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const { data, error } = await supabase
    .from('dashboards')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('deleteDenied') }
  revalidatePath('/app')
  revalidatePath('/app/dashboards')
  return { ok: true, data: undefined }
}

/** Rename a dashboard (RLS member+). */
export async function renameDashboard(id: string, name: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const n = name.trim()
  if (!n) return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('nameRequired') }
  const { data, error } = await supabase
    .from('dashboards')
    .update({ name: n })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('changeDenied') }
  revalidatePath('/app')
  revalidatePath('/app/dashboards')
  return { ok: true, data: undefined }
}

/**
 * Edit a widget after the agent created it: title, SQL, refresh interval. SQL edits
 * go through `assertReadOnly` (same guard as alerts/queries), update BOTH the spec
 * envelope (`spec.query.sql`) and the linked saved_query, and clear the cached
 * `sample` so the next render re-runs the new SQL instead of showing stale data.
 */
export async function updateWidget(
  widgetId: string,
  patch: { title?: string; sql?: string; refreshInterval?: number | null },
): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }

  const { data: rows, error: readErr } = await supabase
    .from('dashboard_widgets')
    .select('id, spec, saved_query_id')
    .eq('id', widgetId)
    .is('deleted_at', null) // a removed widget must not be editable (nor its saved_query rewritten)
    .limit(1)
  if (readErr) return { ok: false, reason: 'error', message: readErr.message }
  const row = rows?.[0] as
    | { id: string; spec: Record<string, unknown>; saved_query_id: string | null }
    | undefined
  if (!row) return { ok: false, reason: 'not_found', message: (await getTranslations('dashActions'))('widgetNotFound') }

  const set: Record<string, unknown> = {}
  const spec = { ...(row.spec ?? {}) } as { query?: { sql?: string }; chart?: { title?: string } }
  let specChanged = false

  if (patch.title !== undefined) {
    const t = patch.title.trim()
    if (!t) return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('titleRequired') }
    const title = t.slice(0, 120)
    // Envelope specs keep the title at spec.chart.title; a bare ChartSpec (e.g. a demo widget) keeps
    // it at the TOP level. Writing spec.chart on a bare spec creates a nested key the renderer's
    // ChartSpec parse strips → a silent no-op rename. Detect the shape and write the right place.
    if (spec.chart && typeof spec.chart === 'object') {
      spec.chart = { ...spec.chart, title }
    } else {
      ;(spec as Record<string, unknown>).title = title
    }
    specChanged = true
  }

  if (patch.sql !== undefined) {
    const sql = patch.sql.trim()
    if (!sql) return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('sqlRequired') }
    // Firestore widgets ALWAYS carry a string `query.sql` (a human-readable descriptor) — the
    // real re-run key is `query.firestore`. Editing "SQL" on one would overwrite the descriptor
    // while the re-run still used the untouched firestore query: a silent no-op. Reject instead.
    const q = spec.query as { sql?: unknown; firestore?: unknown } | undefined
    if (!q || typeof q.sql !== 'string' || q.firestore) {
      return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('sqlEditUnsupported') }
    }
    const { assertReadOnly, UnsafeSqlError } = await import('@/lib/query')
    try {
      assertReadOnly(sql)
    } catch (e) {
      const t = await getTranslations('dashActions')
      const msg = e instanceof UnsafeSqlError ? e.message : t('invalidSql')
      return { ok: false, reason: 'error', message: t('queryError', { msg }) }
    }
    spec.query = { ...spec.query, sql }
    specChanged = true
    set.sample = null // stale snapshot — force a live re-run on next render
    if (row.saved_query_id) {
      await supabase.from('saved_queries').update({ sql }).eq('id', row.saved_query_id)
    }
  }

  if (patch.refreshInterval !== undefined) {
    if (
      patch.refreshInterval !== null &&
      (!Number.isInteger(patch.refreshInterval) || patch.refreshInterval < 15 || patch.refreshInterval > 86_400)
    ) {
      return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('refreshRange') }
    }
    set.refresh_interval = patch.refreshInterval
  }

  if (specChanged) set.spec = spec
  if (Object.keys(set).length === 0) return { ok: true, data: undefined }

  const { data, error } = await supabase
    .from('dashboard_widgets')
    .update(set)
    .eq('id', widgetId)
    .is('deleted_at', null)
    .select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('updateDenied') }
  revalidatePath('/app/dashboards')
  return { ok: true, data: undefined }
}

/** Remove (soft-delete) a widget from a dashboard (RLS member+) — the previously dead ⋯ action. */
export async function removeWidget(widgetId: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const { data, error } = await supabase
    .from('dashboard_widgets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', widgetId)
    .is('deleted_at', null)
    .select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) return { ok: false, reason: 'error', message: (await getTranslations('dashActions'))('deleteDenied') }
  revalidatePath('/app/dashboards')
  return { ok: true, data: undefined }
}
