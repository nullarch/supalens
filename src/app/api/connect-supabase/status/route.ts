import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { isRecoveryId } from '@/lib/alerts/recovery'

export const dynamic = 'force-dynamic'

/** Metadata only. Never refresh an OAuth token or run a customer query on page load. */
export async function GET(req: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
  const id = new URL(req.url).searchParams.get('connectionId')
  if (!isRecoveryId(id)) return reply({ error: 'unavailable' }, 400)
  try {
    const db = await createClient()
    if (!db) return reply({ error: 'unavailable' }, 503)
    const { data: { user }, error: authError } = await db.auth.getUser()
    if (authError || !user) return reply({ error: 'denied' }, 401)
    // The caller's JWT and provider_connections RLS enforce organization membership.
    const connection = await db.from('provider_connections').select('id,org_id,status')
      .eq('id', id).eq('provider', 'supabase').is('deleted_at', null).limit(1)
    if (connection.error) return reply({ error: 'unavailable' }, 503)
    const row = connection.data?.[0]
    if (!row) return reply({ error: 'unavailable' }, 404)
    const sources = await db.from('data_sources').select('id', { count: 'exact', head: true })
      .eq('connection_id', id).eq('org_id', row.org_id).eq('provider', 'supabase')
      .eq('status', 'active').is('deleted_at', null)
    if (sources.error || sources.count === null) return reply({ error: 'unavailable' }, 503)
    return reply({ status: row.status, activeSources: sources.count })
  } catch {
    return reply({ error: 'unavailable' }, 503)
  }
}
