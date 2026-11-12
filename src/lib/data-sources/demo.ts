import { randomUUID } from 'crypto'

import { createAdminClient } from '@/utils/supabase/admin'
import { ensureDemoKpiCatalog } from '@/lib/kpi/demo-catalog'

// English (the product default locale) — a stored row name can't follow the viewer's locale,
// and en is the canonical default. Pre-existing orgs keep the name they were provisioned with.
export const DEMO_SOURCE_NAME = 'Demo · E-commerce sample'

/**
 * Ensure the org has its demo data source (idempotent, env-gated). Returns the id, or null when the
 * demo DB isn't configured. The demo is just a normal postgres `data_sources` row (is_demo=true)
 * whose credentials come from DEMO_DATABASE_URL instead of the vault (see resolveDataSource) — so the
 * whole query/agent/picker path is reused unchanged.
 */
export async function ensureDemoSource(orgId: string): Promise<string | null> {
  if (!process.env.DEMO_DATABASE_URL) return null
  const admin = createAdminClient()
  if (!admin) return null

  const { data: existing } = await admin
    .from('data_sources')
    .select('id')
    .eq('org_id', orgId)
    .eq('is_demo', true)
    .is('deleted_at', null)
    .limit(1)

  let sourceId: string
  if (existing && existing.length > 0) {
    sourceId = (existing[0] as { id: string }).id
  } else {
    const id = randomUUID()
    const { error } = await admin.from('data_sources').insert({
      id,
      org_id: orgId,
      connection_id: null,
      name: DEMO_SOURCE_NAME,
      engine: 'postgres',
      provider: 'neon',
      config: { host: 'demo.supalens', database: 'ecommerce', db_user: 'readonly' }, // display-only; creds via env
      status: 'active',
      is_demo: true,
    })
    if (error) {
      console.error('[demo] provision failed:', error.message)
      return null
    }
    sourceId = id
  }

  // Best-effort: seed the canned Auto-KPI catalog (zero LLM) so the demo shows KPI output on first
  // visit. Guarded like the rest of this file — a failure here must never fail the (already-
  // provisioned) demo source, and ensureDemoKpiCatalog is itself idempotent.
  try {
    await ensureDemoKpiCatalog(orgId, sourceId)
  } catch (e) {
    console.error('[demo] KPI catalog seed failed:', e instanceof Error ? e.message : e)
  }

  return sourceId
}
