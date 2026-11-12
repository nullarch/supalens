import { tasks } from '@trigger.dev/sdk'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { getLocale } from 'next-intl/server'

import { checkUsageQuota } from '@/lib/plans/usage'
import { isSqlEngine } from '@/lib/data-sources/engines'
import {
  createExtraction,
  failExtraction,
  latestExtraction,
  setExtractionTriggerRunId,
  EXTRACTION_RUNNING_TTL_MS,
  EXTRACTION_ALREADY_RUNNING,
} from '@/lib/kpi/service'
import { KPI_CATEGORIES, type KpiCategory } from '@/lib/kpi/types'
import { persistableError } from '@/lib/supabase-oauth/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Payload contract for the `extract-kpis` Trigger.dev task (built in parallel — declared locally,
 * never imported from trigger/, mirroring how the context route builds its payload inline). Repo
 * fields are present only for a tier-2 (repo-attached) run.
 */
interface ExtractKpisPayload {
  orgId: string
  dataSourceId: string
  extractionId: string
  tier: 1 | 2
  userId: string
  /** Major-category scope from the extraction modal; absent = every category. */
  categories?: KpiCategory[]
  repoId?: string
  installationId?: number
  fullName?: string
  ref?: string
  sparsePaths?: string[]
}

/** Parse the optional `{ categories }` body — validated against KPI_CATEGORIES, deduped. An absent
 * or empty body (e.g. the review page's re-extract) yields undefined = all categories. */
async function parseCategories(req: Request): Promise<KpiCategory[] | undefined> {
  const body = (await req.json().catch(() => null)) as { categories?: unknown } | null
  if (!body || !Array.isArray(body.categories)) return undefined
  const valid = body.categories.filter(
    (c: unknown): c is KpiCategory => typeof c === 'string' && (KPI_CATEGORIES as readonly string[]).includes(c),
  )
  return valid.length > 0 ? Array.from(new Set(valid)) : undefined
}

/**
 * Kick off a KPI extraction run on the Trigger.dev host. tier-1 (no repo) runs schema-only; tier-2
 * (repo attached) clones the repo + runs the code × DB agent. SQL sources only (Firestore v1 is
 * unsupported), non-demo only. Member+ (owner/admin/member). Metered by checkUsageQuota (402).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const categories = await parseCategories(req)

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

  const admin = requireAdminClient()

  // engine / demo / repo_id — repo_id + is_demo are columns added after the last db:types run.
  const { data: dsFull } = await admin
    .from('data_sources')
    .select('engine, repo_id, is_demo')
    .eq('id', id)
    .limit(1)
  const dsRow = dsFull?.[0] as { engine: string; repo_id: string | null; is_demo: boolean | null } | undefined

  // v1 is SQL-only (whitelist — a future non-SQL engine must be rejected here too, not run
  // through the SQL extractor). Demo sources ship a canned catalog instead of an LLM extraction.
  if (!isSqlEngine(dsRow?.engine)) {
    return Response.json(
      { error: 'engine_not_supported', message: 'KPI extraction v1 supports SQL data sources only (postgres/mysql).' },
      { status: 400 }
    )
  }
  if (dsRow?.is_demo) {
    return Response.json(
      { error: 'demo_not_supported', message: 'The demo source ships a built-in KPI catalog; extraction is not run for it.' },
      { status: 400 }
    )
  }

  // Don't stack extractions: a 'running' run younger than the TTL blocks a fresh trigger. (The DB
  // partial unique index is the race-proof backstop; this is the friendly early 409.)
  const latest = await latestExtraction(id)
  if (latest && latest.status === 'running') {
    if (Date.now() - new Date(latest.createdAt).getTime() < EXTRACTION_RUNNING_TTL_MS) {
      return Response.json({ error: 'extraction_in_progress' }, { status: 409 })
    }
    // Stale 'running' (task died without a completion signal) → fail it so the one-running-per-source
    // unique index frees its slot; otherwise the new trigger below would be blocked indefinitely.
    await failExtraction(latest.id, 'timed out (no completion signal)')
  }

  // Metered quota gate (billing / cost-abuse guard) — mirrors /api/data-sources/[id]/context.
  const quota = await checkUsageQuota(orgId, { locale: await getLocale() })
  if (!quota.allowed) {
    return Response.json(
      { error: 'quota_exceeded', reason: quota.reason, limitType: quota.limitType, usage: quota },
      { status: 402 }
    )
  }

  // Tier: repo attached -> tier 2 (resolve repo + installation, assert same org); else tier 1.
  const repoId = dsRow?.repo_id ?? null
  let tier: 1 | 2 = 1
  let repo:
    | { id: string; full_name: string; default_branch: string; sparse_paths: string[] | null }
    | undefined
  let installationId: number | undefined

  if (repoId) {
    const { data: repoRows } = await admin
      .from('github_repositories')
      .select('id, org_id, connection_id, full_name, default_branch, sparse_paths')
      .eq('id', repoId)
      .is('deleted_at', null)
      .limit(1)
    const r = repoRows?.[0] as
      | { id: string; org_id: string; connection_id: string; full_name: string; default_branch: string; sparse_paths: string[] | null }
      | undefined
    if (!r || r.org_id !== orgId) return Response.json({ error: 'repo_invalid' }, { status: 409 })

    const { data: connRows } = await admin
      .from('provider_connections')
      .select('installation_id')
      .eq('id', r.connection_id)
      .limit(1)
    const instId = (connRows?.[0] as { installation_id: number | null } | undefined)?.installation_id
    if (instId == null) return Response.json({ error: 'installation_not_found' }, { status: 409 })

    tier = 2
    repo = { id: r.id, full_name: r.full_name, default_branch: r.default_branch, sparse_paths: r.sparse_paths }
    installationId = instId
  }

  // Both tiers run on the Trigger host (the agent needs a subprocess) — there is no Vercel-inline
  // fallback, exactly like /api/code/analyze.
  if (!process.env.TRIGGER_SECRET_KEY) {
    return Response.json({ error: 'trigger_required' }, { status: 503 })
  }

  let extractionId: string
  try {
    ;({ id: extractionId } = await createExtraction({ orgId, dataSourceId: id, tier, createdBy: user.id }))
  } catch (e) {
    // a concurrent trigger won the race to the single running slot → in-progress, not an error
    if (e instanceof Error && e.message === EXTRACTION_ALREADY_RUNNING) {
      return Response.json({ error: 'extraction_in_progress' }, { status: 409 })
    }
    throw e
  }

  const payload: ExtractKpisPayload = {
    orgId,
    dataSourceId: id,
    extractionId,
    tier,
    userId: user.id,
    ...(categories ? { categories } : {}),
    ...(tier === 2 && repo
      ? {
          repoId: repo.id,
          installationId,
          fullName: repo.full_name,
          ref: repo.default_branch,
          sparsePaths: repo.sparse_paths ?? undefined,
        }
      : {}),
  }

  try {
    const handle = await tasks.trigger('extract-kpis', payload, { concurrencyKey: id })
    await setExtractionTriggerRunId(extractionId, handle.id)
    return Response.json({ ok: true, extractionId, tier })
  } catch (err) {
    await failExtraction(extractionId, persistableError(err, String(err).slice(0, 200)))
    return Response.json({ error: 'trigger_failed' }, { status: 502 })
  }
}
