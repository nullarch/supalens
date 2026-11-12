import { z } from 'zod'

import { createClient } from '@/utils/supabase/server'
import { applyKpis, planKpiApply } from '@/lib/kpi/apply'
import { getLocale } from 'next-intl/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ApplyBody = z.object({
  kpiIds: z.array(z.string()).min(1).max(40),
  // 'new' is accepted as a synonym for absent (the idempotent core-kpi dashboard) — resolved in applyKpis.
  dashboardId: z.string().optional(),
  withAlerts: z.boolean().default(true),
  /** Preview only: return the ApplyPlan (monitors / dashboard-only / cap-blocked) and write nothing. */
  dryRun: z.boolean().default(false),
})

/**
 * One-shot apply: turn reviewed KPI proposals into a live dashboard + widgets (+ optional alerts).
 * Member+ (owner/admin/member). Thin route — auth + membership + body parse, then delegate the whole
 * transaction to applyKpis (admin-side, per-item continue-on-failure). Returns the ApplyKpisResult.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  // RLS visibility confirms the source is in the caller's org; membership check gates member+.
  const { data: rows } = await supabase
    .from('data_sources')
    .select('id, org_id')
    .eq('id', id)
    .is('deleted_at', null)
    .limit(1)
  if (!rows || rows.length === 0) return Response.json({ error: 'forbidden' }, { status: 403 })
  const orgId = (rows[0] as { org_id: string }).org_id

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const role = (membership?.[0] as { role: string } | undefined)?.role
  if (!role || !['owner', 'admin', 'member'].includes(role)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = ApplyBody.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 })

  const applyArgs = {
    orgId,
    userId: user.id,
    dataSourceId: id,
    kpiIds: parsed.data.kpiIds,
    dashboardId: parsed.data.dashboardId,
    withAlerts: parsed.data.withAlerts,
    locale: await getLocale(),
  }

  try {
    if (parsed.data.dryRun) return Response.json({ plan: await planKpiApply(applyArgs) })
    const result = await applyKpis(applyArgs)
    return Response.json(result)
  } catch (e) {
    // applyKpis only throws when the dashboard itself can't be established (bad id, or the plan's
    // dashboard cap on create) — nothing was written. Everything else is per-item in the body.
    const message = e instanceof Error ? e.message : String(e)
    const status = message === 'dashboard_not_in_org' ? 403 : 400
    return Response.json({ error: 'apply_failed', message }, { status })
  }
}
