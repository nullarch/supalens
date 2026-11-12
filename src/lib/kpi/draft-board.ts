/**
 * Draft home board — "the AI builds the dashboard".
 *
 * Right after a KPI extraction completes, Supalens turns the most important proposals into widgets
 * on the workspace's auto-KPI board (slug core-kpi), so the overview shows real charts before
 * anyone has reviewed anything. The draft is deliberately limited:
 *
 *   - WIDGETS ONLY. Monitors (alerts) are created only when a person approves the KPI — a draft
 *     must never start sending notifications on its own.
 *   - Proposals stay 'proposed'. Approval later ADOPTS the draft widget (apply.ts findDraftWidget)
 *     instead of adding a duplicate, and flips the KPI to 'accepted' with its monitor.
 *   - Once per data source: if the board already carries a widget from this source (a previous
 *     draft, an approval, a person's own chart), nothing is added — re-extraction never re-clutters
 *     a board someone has already shaped.
 *   - Read-only queries only: every widget re-runs through the guarded engine (buildWidgetSpec),
 *     and plan caps (dashboards, widgets per board) apply exactly as for a manual apply.
 *
 * No LLM runs here, so no usage gate. NOT `import 'server-only'` — runs on the Trigger.dev host
 * (runKpiExtraction) and from the overview's server action.
 */
import { requireAdminClient } from '@/utils/supabase/admin'
import { listKpis } from '@/lib/kpi/service'
import type { KpiCatalogRow } from '@/lib/kpi/types'
import { createKpiWidget, resolveDashboard } from '@/lib/kpi/apply'

/** Widgets a draft adds — enough to be a board, few enough to stay readable. */
export const DRAFT_WIDGET_LIMIT = 6

export type DraftBoardResult =
  | { ok: true; created: number; dashboardSlug: string }
  | { ok: false; reason: 'no_proposals' | 'board_has_source' | 'cap' | 'error'; message?: string; dashboardSlug?: string }

/** The proposals a draft uses: still-proposed, most important first (stable by catalog order). */
export function draftCandidates(catalog: KpiCatalogRow[], limit = DRAFT_WIDGET_LIMIT): KpiCatalogRow[] {
  return catalog
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row.status === 'proposed' && !!row.metricSql && !!row.vizSpec?.chart)
    .sort((a, b) => b.row.importance - a.row.importance || a.i - b.i)
    .slice(0, limit)
    .map(({ row }) => row)
}

export async function ensureDraftBoard(args: {
  orgId: string
  dataSourceId: string
  userId?: string | null
  locale?: string
}): Promise<DraftBoardResult> {
  const catalog = await listKpis(args.dataSourceId)
  const candidates = draftCandidates(catalog.filter((row) => row.orgId === args.orgId))
  if (candidates.length === 0) return { ok: false, reason: 'no_proposals' }

  const admin = requireAdminClient()
  let dashboard: { id: string; slug: string; orgId: string }
  try {
    dashboard = await resolveDashboard(admin, { orgId: args.orgId, userId: args.userId ?? null, locale: args.locale })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: /limit|cap|plan/i.test(message) ? 'cap' : 'error', message }
  }

  const { data: existing } = await admin
    .from('dashboard_widgets')
    .select('id, position, data_source_id')
    .eq('dashboard_id', dashboard.id)
    .is('deleted_at', null)
    .order('position', { ascending: false })
  const rows = (existing ?? []) as { id: string; position: number; data_source_id: string | null }[]
  if (rows.some((w) => w.data_source_id === args.dataSourceId)) {
    return { ok: false, reason: 'board_has_source', dashboardSlug: dashboard.slug }
  }

  let position = (rows[0]?.position ?? -1) + 1
  let created = 0
  let capHit: string | undefined
  for (const row of candidates) {
    const result = await createKpiWidget(
      admin,
      { orgId: args.orgId, dataSourceId: args.dataSourceId, userId: args.userId ?? null, locale: args.locale },
      dashboard,
      row,
      position,
      { draft: true },
    )
    if (result.ok) {
      created += 1
      position += 1
    } else if (result.errorKind === 'cap') {
      capHit = result.error
      break // the board is full; later candidates would hit the same cap
    }
    // a single KPI whose query no longer validates is skipped; the rest still land
  }
  if (created === 0) return { ok: false, reason: capHit ? 'cap' : 'error', message: capHit, dashboardSlug: dashboard.slug }
  return { ok: true, created, dashboardSlug: dashboard.slug }
}
