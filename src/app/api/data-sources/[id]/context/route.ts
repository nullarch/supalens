import { randomUUID } from 'crypto'

import { tasks } from '@trigger.dev/sdk'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { generateBaselineContext } from '@/lib/context/baseline'
import { claimContextGenerating, markContextFailed, getContextPlanState } from '@/lib/context/service'
import { canExtractContext } from '@/lib/context/policy'
import { getLocale } from 'next-intl/server'

import { checkUsageQuota, billingActive } from '@/lib/plans/usage'
import { isSqlEngine } from '@/lib/data-sources/engines'
import { persistableError } from '@/lib/supabase-oauth/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Read the current context doc (any org member). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  // RLS visibility on data_sources confirms org membership
  const { data: rows } = await supabase
    .from('data_sources')
    .select('id')
    .eq('id', id)
    .is('deleted_at', null)
    .limit(1)
  if (!rows || rows.length === 0) return Response.json({ error: 'forbidden' }, { status: 403 })

  const admin = requireAdminClient()
  const { data } = await admin
    .from('data_source_context')
    .select('content_md, status, source_repo_id, generated_at, token_estimate, error')
    .eq('data_source_id', id)
    .limit(1)
  return Response.json({ context: data?.[0] ?? null })
}

/**
 * (Re)generate the context doc. No attached repo → tier-1 baseline (regenerated inline from the
 * introspection cache). Attached repo → tier-2 code × DB generation on the Trigger.dev host.
 * Requires org membership (member+).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const admin = requireAdminClient()

  // repo_id is a column added after the last db:types run — read via the untyped admin client.
  const { data: dsFull } = await admin.from('data_sources').select('repo_id, engine').eq('id', id).limit(1)
  const dsRow = dsFull?.[0] as { repo_id: string | null; engine: string } | undefined
  const repoId = dsRow?.repo_id ?? null
  // Only SQL engines get the SQL tools in their tier-2 run (whitelist — Firestore AND any
  // future non-SQL engine run code-only; see runContextGeneration).
  const withDb = isSqlEngine(dsRow?.engine)

  // tier-1: no repo → regenerate the deterministic baseline inline (fast, no Trigger needed).
  if (!repoId) {
    try {
      await generateBaselineContext(id)
      return Response.json({ ok: true, tier: 1 })
    } catch (e) {
      console.error('[context] baseline regeneration failed:', e)
      return Response.json({ error: 'baseline_failed' }, { status: 500 })
    }
  }

  // Plan gate — tier-2 ONLY: free = one lifetime extraction per org (spent by the attach auto-run).
  // Enforced only once billing is live (billingActive), same strand-avoidance rule as checkUsageQuota.
  // 402 with a distinct code so the UI can show the upgrade copy instead of the cycle-quota copy.
  if (billingActive()) {
    const planState = await getContextPlanState(orgId)
    if (!canExtractContext(planState.plan, planState.extractionsUsed)) {
      return Response.json({ error: 'context_limit' }, { status: 402 })
    }
  }

  // Cost-abuse gate — tier-2 ONLY (tier-1 above is a deterministic digest, no LLM). tier-2 clones the
  // repo + runs the code×DB agent on the Trigger host, so it must respect the same metered/abuse budget
  // as /api/agent/analyze. checkUsageQuota also enforces the billing-independent daily run cap.
  const quota = await checkUsageQuota(orgId, { locale: await getLocale() })
  if (!quota.allowed) {
    return Response.json(
      { error: 'quota_exceeded', reason: quota.reason, limitType: quota.limitType, usage: quota },
      { status: 402 },
    )
  }

  // tier-2: resolve the repo + installation, assert same org, trigger the generation task.
  const { data: repoRows } = await admin
    .from('github_repositories')
    .select('id, org_id, connection_id, full_name, default_branch, sparse_paths')
    .eq('id', repoId)
    .is('deleted_at', null)
    .limit(1)
  const repo = repoRows?.[0] as
    | {
        id: string
        org_id: string
        connection_id: string
        full_name: string
        default_branch: string
        sparse_paths: string[] | null
      }
    | undefined
  if (!repo || repo.org_id !== orgId) return Response.json({ error: 'repo_invalid' }, { status: 409 })

  const { data: connRows } = await admin
    .from('provider_connections')
    .select('installation_id')
    .eq('id', repo.connection_id)
    .limit(1)
  const installationId = (connRows?.[0] as { installation_id: number | null } | undefined)?.installation_id
  if (installationId == null) return Response.json({ error: 'installation_not_found' }, { status: 409 })

  if (!process.env.TRIGGER_SECRET_KEY) {
    // tier-2 needs Trigger (clone + subprocess) — there is no Vercel-inline fallback.
    return Response.json({ error: 'trigger_required' }, { status: 503 })
  }

  // One-running-per-source guard: two concurrent POSTs (ask gate + sources page, or two members)
  // must not both clone + run the LLM — the loser would silently overwrite the winner's doc AND
  // double the cost. 409 mirrors the KPI-extraction "already in progress" contract.
  if (!(await claimContextGenerating(id, orgId, repoId))) {
    return Response.json({ error: 'generation_in_progress' }, { status: 409 })
  }
  const runId = randomUUID()
  try {
    const handle = await tasks.trigger(
      'generate-context',
      {
        orgId,
        dataSourceId: id,
        repoId: repo.id,
        installationId,
        fullName: repo.full_name,
        runId,
        ref: repo.default_branch,
        sparsePaths: repo.sparse_paths ?? undefined,
        withDb,
        userId: user.id,
      },
      { concurrencyKey: repo.id },
    )
    return Response.json({ ok: true, tier: 2, triggerRunId: handle.id })
  } catch (err) {
    await markContextFailed(id, orgId, persistableError(err, String(err).slice(0, 200)))
    return Response.json({ error: 'trigger_failed' }, { status: 502 })
  }
}
