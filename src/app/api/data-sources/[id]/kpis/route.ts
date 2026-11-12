import { z } from 'zod'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { latestExtraction, listKpis, setKpiStatus } from '@/lib/kpi/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PatchBody = z.object({
  kpiIds: z.array(z.string()).min(1),
  status: z.enum(['dismissed', 'proposed']),
})

/**
 * Read the KPI catalog for a source. Any org member (incl. viewer) may READ — RLS visibility on
 * data_sources confirms membership; the catalog rows are then read via the untyped admin client
 * (mirroring how the context route reads data_source_context after its own RLS check).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  // RLS visibility on data_sources confirms org membership.
  const { data: rows } = await supabase.from('data_sources').select('id').eq('id', id).is('deleted_at', null).limit(1)
  if (!rows || rows.length === 0) return Response.json({ error: 'forbidden' }, { status: 403 })

  // name + engine + repo_id: repo_id is a column added after the last db:types run — read via admin.
  const admin = requireAdminClient()
  const { data: dsFull } = await admin.from('data_sources').select('name, engine, repo_id, org_id').eq('id', id).limit(1)
  const dsRow = dsFull?.[0] as { name: string; engine: string; repo_id: string | null; org_id: string } | undefined

  // caller's role in the source's org → canManage (viewer = read-only). Lets the review MODAL render
  // with one fetch; the apply/PATCH routes enforce the same role server-side regardless.
  let canManage = false
  if (dsRow?.org_id) {
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('org_id', dsRow.org_id)
      .eq('user_id', user.id)
      .limit(1)
    const role = (membership?.[0] as { role: string } | undefined)?.role
    canManage = !!role && ['owner', 'admin', 'member'].includes(role)
  }

  const [extraction, kpis] = await Promise.all([latestExtraction(id), listKpis(id)])
  return Response.json({
    source: { id, name: dsRow?.name ?? null, engine: dsRow?.engine ?? null, repoId: dsRow?.repo_id ?? null },
    extraction,
    kpis,
    canManage,
  })
}

/**
 * Dismiss / restore catalog rows — powers the review page's dismiss (status='dismissed', excluded
 * from future re-extractions) and undo (status='proposed'). Member+ (owner/admin/member); the DB
 * guard trigger additionally restricts non-service roles to the status/applied columns.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

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
  const parsed = PatchBody.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 })

  await setKpiStatus({ ids: parsed.data.kpiIds, dataSourceId: id, status: parsed.data.status })
  return Response.json({ ok: true })
}
