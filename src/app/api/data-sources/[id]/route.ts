import { randomUUID } from 'crypto'

import { tasks } from '@trigger.dev/sdk'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { removeDirectDataSource } from '@/lib/data-sources'
import { isSqlEngine } from '@/lib/data-sources/engines'
import { markContextGenerating, getContextPlanState } from '@/lib/context/service'
import { canExtractContext } from '@/lib/context/policy'
import { checkUsageQuota, billingActive } from '@/lib/plans/usage'
import { trackServer } from '@/lib/analytics/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Attach or detach a GitHub repo to a data source (sets data_sources.repo_id). Requires org
 *  membership (member+); the repo must be in the SAME org. Detach with { repoId: null }. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select('id, org_id, engine')
    .eq('id', id)
    .is('deleted_at', null)
    .limit(1)
  if (!rows || rows.length === 0) return Response.json({ error: 'forbidden' }, { status: 403 })
  const dsRow = rows[0] as { org_id: string; engine: string }
  const orgId = dsRow.org_id
  const engine = dsRow.engine

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

  let body: { repoId?: string | null }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const repoId = body.repoId ? String(body.repoId).trim() : null

  let repoMeta: { full_name: string; connection_id: string; default_branch: string } | null = null
  if (repoId) {
    // repo must be visible (member) AND in the same org (defense-in-depth; a DB trigger also enforces).
    const { data: repoRows } = await supabase
      .from('github_repositories')
      .select('id, org_id, full_name, connection_id, default_branch')
      .eq('id', repoId)
      .is('deleted_at', null)
      .limit(1)
    if (!repoRows || repoRows.length === 0) return Response.json({ error: 'repo_forbidden' }, { status: 403 })
    const r = repoRows[0] as { org_id: string; full_name: string; connection_id: string; default_branch: string }
    if (r.org_id !== orgId) return Response.json({ error: 'cross_org_not_allowed' }, { status: 403 })
    repoMeta = { full_name: r.full_name, connection_id: r.connection_id, default_branch: r.default_branch }
  }

  // repo_id was added after the last db:types run — write via the untyped admin client.
  const admin = requireAdminClient()
  const { error } = await admin.from('data_sources').update({ repo_id: repoId }).eq('id', id)
  if (error) return Response.json({ error: 'update_failed' }, { status: 500 })

  // Funnel: attaching the code is the activation step between "database connected" and
  // "business rules understood". A detach ({repoId:null}) is not an activation event.
  if (repoId) trackServer('repo_attached', user.id, { org_id: orgId, source_id: id })

  // On ATTACH: auto-generate the code-aware (tier-2) SUPALENS.md context so the user doesn't have to
  // click "재생성". Best-effort — needs Trigger + the repo's installation token (minted on the host).
  // This triggers a full clone + code×DB agent run (LLM), so it is a metered LLM entry point: gate on
  // checkUsageQuota (the maintenance invariant + billing-independent daily abuse cap). Unlike the
  // explicit POST /context path we do NOT 402 here — attaching the repo is a cheap DB write that must
  // still succeed; we simply SKIP the auto-generation when over budget (the user can regenerate later).
  if (repoId && repoMeta && process.env.TRIGGER_SECRET_KEY) {
    // Same plan gate as POST /context: on free the attach auto-run IS the one lifetime extraction —
    // once spent, attach still succeeds but the auto-generation is skipped (upgrade to regenerate).
    if (billingActive()) {
      const planState = await getContextPlanState(orgId)
      if (!canExtractContext(planState.plan, planState.extractionsUsed)) {
        trackServer('context_generation_skipped', user.id, {
          org_id: orgId,
          source_id: id,
          failure_code: 'context_limit',
        })
        return Response.json({ ok: true, repoId, contextGenerationSkipped: 'context_limit' })
      }
    }
    const quota = await checkUsageQuota(orgId)
    if (!quota.allowed) {
      trackServer('context_generation_skipped', user.id, {
        org_id: orgId,
        source_id: id,
        failure_code: 'quota_exceeded',
      })
      return Response.json({ ok: true, repoId, contextGenerationSkipped: 'quota_exceeded' })
    }
    try {
      const { data: connRows } = await supabase
        .from('provider_connections')
        .select('installation_id')
        .eq('id', repoMeta.connection_id)
        .limit(1)
      const installationId = (connRows?.[0] as { installation_id: number | null } | undefined)?.installation_id
      if (installationId != null) {
        await markContextGenerating(id, orgId, repoId)
        await tasks.trigger(
          'generate-context',
          {
            orgId,
            dataSourceId: id,
            repoId,
            installationId,
            fullName: repoMeta.full_name,
            runId: randomUUID(),
            ref: repoMeta.default_branch,
            withDb: isSqlEngine(engine),
          },
          { concurrencyKey: repoId },
        )
      }
    } catch (e) {
      console.error('[data-sources] auto context generation on attach failed:', e)
    }
  }

  return Response.json({ ok: true, repoId })
}

/** Remove a direct data source. Requires owner/admin of its org. OAuth/Supabase sources
 *  must be removed via the Supabase disconnect flow, not here. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select('id, org_id, connection_id')
    .eq('id', id)
    .is('deleted_at', null)
    .limit(1)
  if (!rows || rows.length === 0) return Response.json({ error: 'forbidden' }, { status: 403 })

  const ds = rows[0] as { org_id: string; connection_id: string | null }
  if (ds.connection_id) {
    return Response.json({ error: 'use_disconnect_for_oauth_sources' }, { status: 400 })
  }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', ds.org_id)
    .eq('user_id', user.id)
    .limit(1)
  const role = (membership?.[0] as { role: string } | undefined)?.role
  if (role !== 'owner' && role !== 'admin') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  await removeDirectDataSource(id, { kind: 'user', id: user.id })
  return Response.json({ ok: true })
}
