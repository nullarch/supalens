import { createHmac, timingSafeEqual, randomUUID } from 'crypto'

import { tasks } from '@trigger.dev/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'

import { requireAdminClient } from '@/utils/supabase/admin'
import { getGithubAppConfig } from '@/lib/github-app/config'
import { claimContextGenerating, markContextStale, getContextPlanState } from '@/lib/context/service'
import { shouldAutoRegenContext } from '@/lib/context/policy'
import { markProposalsStaleForRepo } from '@/lib/kpi/service'
import { checkUsageQuota } from '@/lib/plans/usage'
import { isSqlEngine } from '@/lib/data-sources/engines'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Verify X-Hub-Signature-256 (HMAC-SHA256 over the RAW body) in constant time. */
function verifySignature(secret: string, raw: string, signature: string): boolean {
  if (!signature.startsWith('sha256=')) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * GitHub App webhook. One endpoint for the whole app. Verifies the signature, de-dupes on
 * the delivery GUID, and (on push) triggers an incremental code-analysis run for each
 * connected repo with analysis_enabled. Responds fast; the heavy work is the Trigger task.
 */
export async function POST(req: Request) {
  const raw = await req.text() // RAW body — verify before any JSON parse
  const signature = req.headers.get('x-hub-signature-256') ?? ''
  const event = req.headers.get('x-github-event') ?? ''
  const delivery = req.headers.get('x-github-delivery') ?? ''

  let cfg
  try {
    cfg = getGithubAppConfig()
  } catch {
    return Response.json({ error: 'github_app_not_configured' }, { status: 500 })
  }
  if (!verifySignature(cfg.webhookSecret, raw, signature)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 })
  }
  if (!event || !delivery) return Response.json({ error: 'missing_headers' }, { status: 400 })

  const admin = requireAdminClient()

  // Idempotency: the delivery_id is UNIQUE. A duplicate insert (GitHub retry) → skip.
  // Only a unique-violation (23505) is a real duplicate; any other insert error is a
  // transient fault — 500 so GitHub retries rather than silently dropping the delivery.
  const { error: dupErr } = await admin
    .from('github_webhook_events')
    .insert({ delivery_id: delivery, event_type: event, status: 'received' })
  if (dupErr) {
    if (dupErr.code === '23505') return Response.json({ ok: true, duplicate: true })
    console.error(`[github-webhook] idempotency insert failed for ${delivery}:`, dupErr)
    Sentry.captureException(dupErr, { tags: { event, delivery } })
    return Response.json({ error: 'ingest_failed' }, { status: 500 })
  }

  if (event === 'ping') return Response.json({ ok: true, pong: true })

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  try {
    if (event === 'push') {
      await handlePush(admin, payload, delivery)
    } else if (event === 'installation' || event === 'installation_repositories') {
      await handleInstallation(admin, payload)
    }
  } catch (err) {
    console.error(`[github-webhook] ${event} ${delivery} failed:`, err)
    Sentry.captureException(err, { tags: { event, delivery } })
    // A handler fault must not CONSUME the delivery: release the dedupe row and answer non-2xx
    // so GitHub redelivers — otherwise a transient fault silently drops the push (no incremental
    // analysis, no staleness marking). Mirrors the Slack events route's failure contract.
    await admin.from('github_webhook_events').delete().eq('delivery_id', delivery)
    return Response.json({ error: 'processing_failed' }, { status: 500 })
  }

  return Response.json({ ok: true })
}

async function handlePush(admin: SupabaseClient, payload: Record<string, unknown>, delivery: string): Promise<void> {
  const repository = (payload.repository ?? {}) as { id?: number; full_name?: string }
  const ref = (payload.ref as string) ?? ''
  const before = payload.before as string | undefined
  const after = payload.after as string | undefined
  const repoGithubId = repository.id
  const fullName = repository.full_name
  if (!repoGithubId || !fullName) return
  const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref

  const { data: repos } = await admin
    .from('github_repositories')
    .select('id, org_id, connection_id, default_branch, analysis_enabled')
    .eq('github_repo_id', repoGithubId)
    .is('deleted_at', null)

  for (const repo of (repos ?? []) as Array<{
    id: string
    org_id: string
    connection_id: string
    default_branch: string
    analysis_enabled: boolean
  }>) {
    if (!repo.analysis_enabled) continue
    if (branch && repo.default_branch && branch.toLowerCase() !== repo.default_branch.toLowerCase()) continue

    // Best-effort KPI staleness (free, no LLM): a push to the default branch of an attached repo can
    // invalidate the repo-derived KPI catalog, so flip still-'proposed' KPIs of every attached data
    // source to 'stale'. Placed BEFORE the quota/abuse gate on purpose — it costs nothing, so a code
    // change should surface an "오래됨" chip even when the org is over its LLM budget. Individually
    // guarded so a failure here can never abort the loop or change the 200 we owe GitHub (stronger
    // than the outer try/catch, which would mark the whole delivery invalid).
    try {
      await markProposalsStaleForRepo(repo.id)
    } catch (staleErr) {
      console.warn(`[github-webhook] KPI staleness for repo ${repo.id} failed:`, staleErr)
      Sentry.captureException(staleErr, { tags: { event: 'push', delivery, step: 'kpi_staleness' } })
    }

    // Cost-abuse gate: a push is an AUTOMATED LLM entry (spawns analyze-code + context regen) and was
    // previously unbounded. Skip — NOT 402 — when the org is over budget, so GitHub still gets its 200
    // (no retry storm) and other repos/orgs in this delivery are unaffected. checkUsageQuota also
    // enforces the billing-independent daily run cap, so a push-spamming repo self-throttles.
    const quota = await checkUsageQuota(repo.org_id)
    if (!quota.allowed) {
      console.warn(`[github-webhook] quota/abuse cap hit for org ${repo.org_id}; skipping analysis for repo ${repo.id}`)
      continue
    }

    const { data: conn } = await admin
      .from('provider_connections')
      .select('installation_id')
      .eq('id', repo.connection_id)
      .limit(1)
    const installationId = (conn?.[0] as { installation_id: number | null } | undefined)?.installation_id
    if (installationId == null) continue

    await admin
      .from('github_repositories')
      .update({ last_pushed_at: new Date().toISOString(), last_synced_sha: after ?? null })
      .eq('id', repo.id)

    if (!process.env.TRIGGER_SECRET_KEY) continue

    const runId = randomUUID()
    await admin.from('code_analysis_runs').insert({
      id: runId,
      org_id: repo.org_id,
      repo_id: repo.id,
      kind: 'push',
      status: 'queued',
      ref,
      before_sha: before ?? null,
      after_sha: after ?? null,
    })
    const question = `Review the changes pushed to ${branch} (${(before ?? '').slice(0, 7)}..${(after ?? '').slice(0, 7)}). Report any bugs, security issues, or risks the diff introduces. Use get_diff to focus on what changed.`
    const handle = await tasks.trigger(
      'analyze-code',
      {
        orgId: repo.org_id,
        repoId: repo.id,
        installationId,
        fullName,
        runId,
        question,
        ref: branch,
        beforeSha: before,
        afterSha: after,
      },
      { concurrencyKey: repo.id }
    )
    await admin.from('code_analysis_runs').update({ trigger_run_id: handle.id }).eq('id', runId)
    await admin
      .from('github_webhook_events')
      .update({ installation_id: installationId, repo_full_name: fullName, org_id: repo.org_id, run_id: runId, status: 'triggered' })
      .eq('delivery_id', delivery)

    // Also refresh the SUPALENS.md context for any data source that has THIS repo attached —
    // attaching a repo opts the source into code-aware context, so keep it fresh as code changes.
    await regenerateAttachedContext(admin, repo.id, repo.org_id, installationId, fullName, branch)
  }
}

/**
 * Refresh the SUPALENS.md context for every active data source that has this repo attached.
 * A push is a SIGNAL, not an unconditional trigger: the plan's cooldown policy decides between a
 * real tier-2 regeneration (standard/premium, at most once per cooldown window per source) and a
 * free stale-mark (free/basic, or inside the cooldown) — the doc keeps injecting either way, just
 * flagged. This is the cost bound: without it, push count = LLM run count.
 */
async function regenerateAttachedContext(
  admin: SupabaseClient,
  repoId: string,
  orgId: string,
  installationId: number,
  fullName: string,
  branch: string,
): Promise<void> {
  const { data: sources } = await admin
    .from('data_sources')
    .select('id, engine')
    .eq('repo_id', repoId)
    .eq('status', 'active')
    .is('deleted_at', null)
  const attached = (sources ?? []) as Array<{ id: string; engine: string }>
  if (attached.length === 0) return

  const { plan } = await getContextPlanState(orgId)

  // Cooldown input: last SUCCESSFUL generation per source (generated_at is only written on
  // success; markContextFailed leaves it, so a failed regen stays retry-eligible on the next push).
  const { data: ctxRows } = await admin
    .from('data_source_context')
    .select('data_source_id, generated_at')
    .in(
      'data_source_id',
      attached.map((s) => s.id),
    )
  const lastGenerated = new Map(
    ((ctxRows ?? []) as Array<{ data_source_id: string; generated_at: string | null }>).map((r) => [
      r.data_source_id,
      r.generated_at,
    ]),
  )

  for (const ds of attached) {
    if (!shouldAutoRegenContext(plan, lastGenerated.get(ds.id) ?? null, new Date())) {
      await markContextStale(ds.id) // free — surfaces the "stale" chip; fresh docs only
      continue
    }
    // one-running-per-source: a rapid push series must not stack concurrent regenerations
    if (!(await claimContextGenerating(ds.id, orgId, repoId))) continue
    await tasks.trigger(
      'generate-context',
      {
        orgId,
        dataSourceId: ds.id,
        repoId,
        installationId,
        fullName,
        runId: randomUUID(),
        ref: branch,
        withDb: isSqlEngine(ds.engine),
      },
      { concurrencyKey: repoId },
    )
  }
}

async function handleInstallation(admin: SupabaseClient, payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string | undefined
  const installation = (payload.installation ?? {}) as { id?: number }
  const installationId = installation.id
  if (!installationId) return

  // App uninstalled on GitHub → soft-delete our connection + repos (mirror of disconnectGithub).
  if (action === 'deleted') {
    const now = new Date().toISOString()
    const { data: conns } = await admin
      .from('provider_connections')
      .select('id')
      .eq('installation_id', installationId)
      .is('deleted_at', null)
    for (const c of (conns ?? []) as Array<{ id: string }>) {
      await admin.from('github_repositories').update({ status: 'disabled', deleted_at: now }).eq('connection_id', c.id).is('deleted_at', null)
      await admin.from('provider_connections').update({ status: 'revoked', deleted_at: now }).eq('id', c.id)
    }
  }
  // installation_repositories added/removed → reconcile our repo rows so a repo removed on
  // GitHub stops triggering push analyses (its token mint would 403 anyway), and an added
  // repo appears without the user re-opening Connect.
  if (action === 'added' || action === 'removed') {
    type RepoRef = { id?: number; full_name?: string; private?: boolean }
    const added = (payload.repositories_added ?? []) as RepoRef[]
    const removed = (payload.repositories_removed ?? []) as RepoRef[]

    const { data: conns } = await admin
      .from('provider_connections')
      .select('id, org_id')
      .eq('installation_id', installationId)
      .is('deleted_at', null)
    const connections = (conns ?? []) as Array<{ id: string; org_id: string }>
    if (connections.length === 0) return

    const now = new Date().toISOString()
    for (const conn of connections) {
      for (const r of removed) {
        if (!r.id) continue
        await admin
          .from('github_repositories')
          .update({ status: 'disabled', analysis_enabled: false, deleted_at: now })
          .eq('connection_id', conn.id)
          .eq('github_repo_id', r.id)
          .is('deleted_at', null)
      }
      for (const r of added) {
        if (!r.id || !r.full_name) continue
        // live-unique on (org_id, github_repo_id) — skip if a live row already exists
        const { data: existing } = await admin
          .from('github_repositories')
          .select('id')
          .eq('org_id', conn.org_id)
          .eq('github_repo_id', r.id)
          .is('deleted_at', null)
          .limit(1)
        if (existing && existing.length > 0) continue
        await admin.from('github_repositories').insert({
          org_id: conn.org_id,
          connection_id: conn.id,
          github_repo_id: r.id,
          full_name: r.full_name,
          is_private: r.private ?? true,
          clone_url: `https://github.com/${r.full_name}.git`,
          // the webhook payload carries no default_branch; the first push corrects it if needed
          default_branch: 'main',
        })
      }
    }
  }
}
