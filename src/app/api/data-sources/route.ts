import * as Sentry from '@sentry/nextjs'
import { getLocale } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { trackServer } from '@/lib/analytics/server'
import { enforceResourceLimit } from '@/lib/plans/usage'
import {
  parseDirectDataSourceInput,
  parseFirestoreDataSourceInput,
  registerDirectDataSource,
  registerFirestoreDataSource,
  RegistrationError,
  UnsafeHostError,
} from '@/lib/data-sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Register a direct (non-OAuth) data source: PostgreSQL/MySQL, or Firebase Firestore (body.type='firestore'). */
export async function POST(req: Request) {
  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const orgId = await ensurePrimaryOrg(supabase, user)

  // role gate (mirrors the ds_write RLS policy): viewers cannot register sources, which is
  // important because registration is the SSRF-adjacent primitive (outbound connect).
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

  // Plan cap: number of connected data sources for this org.
  const cap = await enforceResourceLimit(orgId, 'database_connections', {
    table: 'data_sources',
    label: 'dataSource',
    locale: await getLocale(),
    softDelete: true,
    filters: [{ column: 'org_id', value: orgId }],
    excludeDemo: true,
  })
  if (!cap.ok) return Response.json({ error: 'limit_reached', message: cap.error }, { status: 402 })

  try {
    // Firebase Firestore (document) vs direct SQL (postgres/mysql) — routed by body.type.
    if ((body as { type?: string } | null)?.type === 'firestore') {
      const parsed = parseFirestoreDataSourceInput(body)
      if (!parsed.ok) return Response.json({ error: 'invalid_input', message: parsed.error }, { status: 400 })
      const res = await registerFirestoreDataSource({ orgId, userId: user.id, input: parsed.value })
      trackServer('source_ready', user.id, { org_id: orgId, source_id: res.dataSourceId, engine: 'firestore' })
      return Response.json({ dataSourceId: res.dataSourceId, latencyMs: res.latencyMs, collections: res.collections })
    }

    const parsed = parseDirectDataSourceInput(body)
    if (!parsed.ok) return Response.json({ error: 'invalid_input', message: parsed.error }, { status: 400 })
    const res = await registerDirectDataSource({ orgId, userId: user.id, input: parsed.value })
    // Funnel: a direct connection is ready the moment registration returns (it probed the DB).
    // The Supabase-OAuth path emits this from the setup provisioning route instead.
    trackServer('source_ready', user.id, { org_id: orgId, source_id: res.dataSourceId, engine: parsed.value.engine })
    return Response.json({ dataSourceId: res.dataSourceId, latencyMs: res.latencyMs })
  } catch (e) {
    if (e instanceof UnsafeHostError) {
      return Response.json({ error: 'unsafe_host', message: e.message }, { status: 400 })
    }
    if (e instanceof RegistrationError) {
      return Response.json({ error: e.code, message: e.message }, { status: e.code === 'duplicate_name' ? 409 : 400 })
    }
    console.error('[data-sources] register failed:', e)
    Sentry.captureException(e)
    return Response.json({ error: 'register_failed' }, { status: 500 })
  }
}
