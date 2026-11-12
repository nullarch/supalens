import { randomUUID } from 'crypto'

import { auth, tasks } from '@trigger.dev/sdk'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { getLocale } from 'next-intl/server'

import { checkUsageQuota } from '@/lib/plans/usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * BFF for the code-analysis agent. Authenticates the user, confirms membership of the repo's
 * org (via RLS), resolves the installation id, optionally binds a data source for code × DB
 * cross-analysis (asserting same org_id), creates the code_analysis_runs row, triggers the
 * Trigger.dev `analyze-code` task, and returns a run id + run-scoped public token.
 *
 * Holds NO GitHub token / DB creds — only TRIGGER_SECRET_KEY. The installation token is
 * minted on the Trigger host (see trigger/analyze-code.ts). Unlike the SQL agent there is no
 * local inline fallback: cloning + a claude subprocess can't run on Vercel, so Trigger is required.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: { repoId?: string; question?: string; dataSourceId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const repoId = body.repoId?.trim()
  if (!repoId) return Response.json({ error: 'repoId is required' }, { status: 400 })
  const question =
    body.question?.trim() || 'Analyze this repository and report the most important findings.'
  if (question.length > 4000) return Response.json({ error: 'question too long' }, { status: 400 })

  // RLS: the repo is visible only to members of its org → membership check + org/connection
  const { data: repoRows, error: repoErr } = await supabase
    .from('github_repositories')
    .select('id, org_id, connection_id, full_name, default_branch')
    .eq('id', repoId)
    .is('deleted_at', null)
    .limit(1)
  if (repoErr) return Response.json({ error: 'lookup_failed' }, { status: 500 })
  if (!repoRows || repoRows.length === 0) return Response.json({ error: 'forbidden' }, { status: 403 })
  const repo = repoRows[0] as {
    id: string
    org_id: string
    connection_id: string
    full_name: string
    default_branch: string
  }

  // Metered quota gate (billing / cost-abuse guard).
  const quota = await checkUsageQuota(repo.org_id, { locale: await getLocale() })
  if (!quota.allowed) {
    return Response.json(
      { error: 'quota_exceeded', reason: quota.reason, limitType: quota.limitType, usage: quota },
      { status: 402 },
    )
  }

  const { data: connRows } = await supabase
    .from('provider_connections')
    .select('installation_id')
    .eq('id', repo.connection_id)
    .limit(1)
  const installationId = (connRows?.[0] as { installation_id: number | null } | undefined)?.installation_id
  if (installationId == null) return Response.json({ error: 'installation_not_found' }, { status: 409 })

  // Optional code × DB cross-analysis: bind a data source, asserting the SAME org so a
  // combined run is still exactly one tenant (invariant #1).
  let dataSourceId: string | undefined
  if (body.dataSourceId?.trim()) {
    const dsId = body.dataSourceId.trim()
    const { data: dsRows } = await supabase
      .from('data_sources')
      .select('id, org_id')
      .eq('id', dsId)
      .is('deleted_at', null)
      .limit(1)
    if (!dsRows || dsRows.length === 0) return Response.json({ error: 'data_source_forbidden' }, { status: 403 })
    if ((dsRows[0] as { org_id: string }).org_id !== repo.org_id) {
      return Response.json({ error: 'cross_org_not_allowed' }, { status: 403 })
    }
    dataSourceId = dsId
  }

  const runId = randomUUID()
  const admin = requireAdminClient()
  const { error: insErr } = await admin.from('code_analysis_runs').insert({
    id: runId,
    org_id: repo.org_id,
    repo_id: repo.id,
    data_source_id: dataSourceId ?? null,
    user_id: user.id,
    kind: dataSourceId ? 'combined' : 'manual',
    status: 'queued',
    ref: `refs/heads/${repo.default_branch}`,
  })
  if (insErr) return Response.json({ error: 'run_create_failed' }, { status: 500 })

  if (!process.env.TRIGGER_SECRET_KEY) {
    // Code analysis needs Trigger (clone + subprocess); there's no Vercel-inline fallback.
    await admin.from('code_analysis_runs').update({ status: 'failed', error: 'trigger_not_configured' }).eq('id', runId)
    return Response.json({ error: 'trigger_required' }, { status: 503 })
  }

  let triggerRunId: string
  try {
    const handle = await tasks.trigger(
      'analyze-code',
      {
        orgId: repo.org_id,
        repoId: repo.id,
        installationId,
        fullName: repo.full_name,
        runId,
        question,
        ref: repo.default_branch,
        dataSourceId,
      },
      { concurrencyKey: repo.id }
    )
    triggerRunId = handle.id
    await admin.from('code_analysis_runs').update({ trigger_run_id: triggerRunId }).eq('id', runId)
  } catch (err) {
    await admin.from('code_analysis_runs').update({ status: 'failed', error: String(err).slice(0, 300) }).eq('id', runId)
    return Response.json({ error: 'trigger_failed' }, { status: 502 })
  }

  const publicToken = await auth.createPublicToken({
    scopes: { read: { runs: [triggerRunId] } },
    expirationTime: '2h',
  })

  return Response.json({ mode: 'trigger', runId, triggerRunId, publicToken })
}
