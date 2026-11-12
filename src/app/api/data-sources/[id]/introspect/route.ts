import { createClient } from '@/utils/supabase/server'
import { syncSchemaCache } from '@/lib/data-sources'
import { hardenDataSourceRole } from '@/lib/supabase-management/harden'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Re-introspect a data source's schema into the cache. Requires org membership (member+). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  // RLS makes the row visible only to members → confirms membership + gives org_id
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

  try {
    // Best-effort: (re)harden the supalens_ro role for Supabase sources — strips a legacy
    // pg_read_all_data grant and covers user schemas created since mint. No-op otherwise.
    await hardenDataSourceRole(id)
    const { objectCount } = await syncSchemaCache(id)
    return Response.json({ ok: true, objectCount })
  } catch (e) {
    console.error('[data-sources] introspect failed:', e)
    return Response.json({ error: 'introspect_failed', message: String(e).slice(0, 200) }, { status: 502 })
  }
}
