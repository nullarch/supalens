import { randomUUID } from 'crypto'

import { tasks } from '@trigger.dev/sdk'
import { getLocale } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { isSqlEngine } from '@/lib/data-sources/engines'
import { canExtractContext } from '@/lib/context/policy'
import { claimContextGenerating, getContextPlanState, markContextFailed } from '@/lib/context/service'
import {
  createExtraction,
  failExtraction,
  latestExtraction,
  setExtractionTriggerRunId,
  EXTRACTION_ALREADY_RUNNING,
  EXTRACTION_RUNNING_TTL_MS,
} from '@/lib/kpi/service'
import { getBootstrapStatus } from '@/lib/bootstrap/status'
import type { BootstrapPhase } from '@/lib/bootstrap/events'
import { billingActive, checkUsageQuota } from '@/lib/plans/usage'
import { persistableError } from '@/lib/supabase-oauth/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Resolve the data source and assert the caller is a member+ of its org. */
async function authorize(dataSourceId: string) {
  const supabase = await createClient()
  if (!supabase) return { error: Response.json({ error: 'supabase_not_configured' }, { status: 500 }) }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'unauthorized' }, { status: 401 }) }

  // RLS visibility on data_sources confirms org membership.
  const { data: rows } = await supabase
    .from('data_sources')
    .select('id, org_id')
    .eq('id', dataSourceId)
    .is('deleted_at', null)
    .limit(1)
  if (!rows || rows.length === 0) return { error: Response.json({ error: 'forbidden' }, { status: 403 }) }
  const orgId = (rows[0] as { org_id: string }).org_id

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const role = (membership?.[0] as { role: string } | undefined)?.role
  if (!role || !['owner', 'admin', 'member'].includes(role)) {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { user, orgId }
}

/**
 * Live scan progress for the setup screen. Derived entirely from persisted state, so it doubles
 * as the resume path: a reload or a second device reconstructs the same picture.
 */
export async function GET(req: Request) {
  const dataSourceId = new URL(req.url).searchParams.get('dataSourceId')
  if (!dataSourceId) return Response.json({ error: 'missing_data_source' }, { status: 400 })

  const auth = await authorize(dataSourceId)
  if (auth.error) return auth.error

  const status = await getBootstrapStatus(dataSourceId)
  return Response.json({ status })
}

/**
 * Start (or resume) the unified onboarding scan: schema → understanding → KPIs as ONE Trigger job.
 *
 * Gates mirror the two standalone routes it replaces, applied ONCE for the whole scan: SQL engines
 * only, no demo source, the tier-2 context plan limit, and `checkUsageQuota` (the LLM entry-point
 * invariant — it also enforces the billing-independent daily run cap). Metering itself stays
 * inside each underlying run, so nothing is counted twice here.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { dataSourceId?: string }
  const dataSourceId = body.dataSourceId
  if (!dataSourceId) return Response.json({ error: 'missing_data_source' }, { status: 400 })

  const auth = await authorize(dataSourceId)
  if (auth.error) return auth.error
  const { user, orgId } = auth

  const admin = requireAdminClient()
  const { data: dsFull } = await admin
    .from('data_sources')
    .select('engine, repo_id, is_demo')
    .eq('id', dataSourceId)
    .limit(1)
  const dsRow = dsFull?.[0] as { engine: string; repo_id: string | null; is_demo: boolean | null } | undefined

  if (!isSqlEngine(dsRow?.engine)) {
    return Response.json({ error: 'engine_not_supported' }, { status: 400 })
  }
  if (dsRow?.is_demo) {
    return Response.json({ error: 'demo_not_supported' }, { status: 400 })
  }

  // Resume from the last phase that actually succeeded — a failed KPI half must not re-clone the
  // repo and re-author a doc we already have.
  const status = await getBootstrapStatus(dataSourceId)
  if (status.active) return Response.json({ error: 'scan_in_progress' }, { status: 409 })
  if (!status.resumeFrom) return Response.json({ ok: true, done: true, status })

  const order: BootstrapPhase[] = ['schema', 'context', 'kpi']
  const skipPhases = order.filter((p) => status.phases[p] === 'done')
  const willRunContext = !skipPhases.includes('context')
  const willRunKpi = !skipPhases.includes('kpi')

  const repoId = dsRow?.repo_id ?? null
  const tier: 1 | 2 = repoId ? 2 : 1
  const withDb = isSqlEngine(dsRow?.engine)

  // tier-2 context is a real LLM extraction — free plans get one lifetime run. Enforced only once
  // billing is live, the same strand-avoidance rule as checkUsageQuota.
  if (willRunContext && tier === 2 && billingActive()) {
    const planState = await getContextPlanState(orgId)
    if (!canExtractContext(planState.plan, planState.extractionsUsed)) {
      return Response.json({ error: 'context_limit' }, { status: 402 })
    }
  }

  // LLM entry point → metered quota + daily abuse cap.
  const quota = await checkUsageQuota(orgId, { locale: await getLocale() })
  if (!quota.allowed) {
    return Response.json(
      { error: 'quota_exceeded', reason: quota.reason, limitType: quota.limitType, usage: quota },
      { status: 402 },
    )
  }

  if (!process.env.TRIGGER_SECRET_KEY) {
    // The scan clones and spawns a subprocess — there is no Vercel-inline fallback.
    return Response.json({ error: 'trigger_required' }, { status: 503 })
  }

  // tier-2: resolve repo + installation and assert same org before spending anything.
  let repo: { id: string; full_name: string; default_branch: string; sparse_paths: string[] | null } | undefined
  let installationId: number | undefined
  if (tier === 2 && repoId) {
    const { data: repoRows } = await admin
      .from('github_repositories')
      .select('id, org_id, connection_id, full_name, default_branch, sparse_paths')
      .eq('id', repoId)
      .is('deleted_at', null)
      .limit(1)
    const r = repoRows?.[0] as
      | {
          id: string
          org_id: string
          connection_id: string
          full_name: string
          default_branch: string
          sparse_paths: string[] | null
        }
      | undefined
    if (!r || r.org_id !== orgId) return Response.json({ error: 'repo_invalid' }, { status: 409 })

    const { data: connRows } = await admin
      .from('provider_connections')
      .select('installation_id')
      .eq('id', r.connection_id)
      .limit(1)
    const instId = (connRows?.[0] as { installation_id: number | null } | undefined)?.installation_id
    if (instId == null) return Response.json({ error: 'installation_not_found' }, { status: 409 })
    repo = { id: r.id, full_name: r.full_name, default_branch: r.default_branch, sparse_paths: r.sparse_paths }
    installationId = instId
  }

  // Free a stale 'running' extraction so the one-running-per-source index doesn't block forever.
  if (willRunKpi) {
    const latest = await latestExtraction(dataSourceId)
    if (latest && latest.status === 'running' && Date.now() - new Date(latest.createdAt).getTime() >= EXTRACTION_RUNNING_TTL_MS) {
      await failExtraction(latest.id, 'timed out (no completion signal)')
    }
  }

  const runId = randomUUID()
  let extractionId = ''
  if (willRunKpi) {
    try {
      ;({ id: extractionId } = await createExtraction({ orgId, dataSourceId, tier, createdBy: user.id }))
    } catch (e) {
      if (e instanceof Error && e.message === EXTRACTION_ALREADY_RUNNING) {
        return Response.json({ error: 'scan_in_progress' }, { status: 409 })
      }
      throw e
    }
  }

  // One-running-per-source guard for the context half (two members hitting "scan" at once must
  // not both clone + run the LLM).
  if (willRunContext && tier === 2 && repoId && !(await claimContextGenerating(dataSourceId, orgId, repoId))) {
    if (extractionId) await failExtraction(extractionId, 'context generation already in progress')
    return Response.json({ error: 'scan_in_progress' }, { status: 409 })
  }

  try {
    const handle = await tasks.trigger(
      'bootstrap-business',
      {
        orgId,
        dataSourceId,
        runId,
        extractionId,
        tier,
        skipPhases,
        withDb,
        userId: user.id,
        ...(repo
          ? {
              repoId: repo.id,
              installationId,
              fullName: repo.full_name,
              ref: repo.default_branch,
              sparsePaths: repo.sparse_paths ?? undefined,
            }
          : {}),
      },
      { concurrencyKey: dataSourceId },
    )
    if (extractionId) await setExtractionTriggerRunId(extractionId, handle.id)
    return Response.json({ ok: true, tier, extractionId, skipPhases, triggerRunId: handle.id })
  } catch (err) {
    if (extractionId) await failExtraction(extractionId, persistableError(err, String(err).slice(0, 200)))
    if (willRunContext && tier === 2) await markContextFailed(dataSourceId, orgId, persistableError(err, String(err).slice(0, 200)))
    return Response.json({ error: 'trigger_failed' }, { status: 502 })
  }
}
