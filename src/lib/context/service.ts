// NOT `import 'server-only'` — read on the agent host (Trigger runtime) to inject the per-source
// context into the prompt, and written there by the context generators. Uses the untyped
// service-role admin client (data_source_context is member-read / service_role-write).
import * as Sentry from '@sentry/node'

import { createAdminClient } from '@/utils/supabase/admin'
import { entitledPlan, type PlanTier } from '@/lib/plans/limits'

export interface SourceContext {
  dataSourceId: string
  contentMd: string
  status: string
  tokenEstimate: number | null
  sourceRepoId: string | null
  generatedAt: string | null
}

// Cap the injected context so a large doc can't blow the per-turn token budget — the whole
// system prompt is re-sent every turn (run-analysis.ts:37). ~24k chars ≈ 6k tokens.
const MAX_INJECT_CHARS = 24_000

/**
 * Read the current per-source context doc for injection. Returns null if none, empty, or not
 * yet usable — only 'fresh'/'stale' docs are injected ('stale' still helps and is flagged).
 */
export async function getSourceContext(dataSourceId: string): Promise<SourceContext | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('data_source_context')
    .select('data_source_id, content_md, status, token_estimate, source_repo_id, generated_at')
    .eq('data_source_id', dataSourceId)
    .limit(1)
  const row = data?.[0] as
    | {
        data_source_id: string
        content_md: string | null
        status: string
        token_estimate: number | null
        source_repo_id: string | null
        generated_at: string | null
      }
    | undefined
  if (!row || !row.content_md) return null
  if (row.status !== 'fresh' && row.status !== 'stale') return null
  return {
    dataSourceId: row.data_source_id,
    contentMd: row.content_md,
    status: row.status,
    tokenEstimate: row.token_estimate,
    sourceRepoId: row.source_repo_id,
    generatedAt: row.generated_at,
  }
}

export interface PutContextArgs {
  dataSourceId: string
  orgId: string
  contentMd: string
  status?: 'fresh' | 'stale' | 'generating' | 'failed'
  sourceRepoId?: string | null
  generatedFromSha?: string | null
  schemaHash?: string | null
  model?: string | null
  generatedBy?: string | null
  error?: string | null
}

/** Upsert the current context doc (service_role). token_estimate is derived from length. */
export async function putSourceContext(args: PutContextArgs): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { error } = await admin.from('data_source_context').upsert(
    {
      data_source_id: args.dataSourceId,
      org_id: args.orgId,
      content_md: args.contentMd,
      status: args.status ?? 'fresh',
      source_repo_id: args.sourceRepoId ?? null,
      generated_from_sha: args.generatedFromSha ?? null,
      schema_hash: args.schemaHash ?? null,
      token_estimate: args.contentMd ? Math.ceil(args.contentMd.length / 4) : 0,
      model: args.model ?? null,
      error: args.error ?? null,
      generated_by: args.generatedBy ?? null,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'data_source_id' },
  )
  if (error) {
    console.error(`[context] putSourceContext failed for ${args.dataSourceId}:`, error.message)
    Sentry.captureMessage(`putSourceContext failed for ${args.dataSourceId}: ${error.message}`, 'error')
  }
}

/** Mark a context row as generating (repo-based tier-2 in flight). Preserves any prior content_md
 *  (upsert sets only the given columns), so a failed regen never destroys the last-good doc. */
export async function markContextGenerating(
  dataSourceId: string,
  orgId: string,
  sourceRepoId: string | null,
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('data_source_context')
    .upsert(
      { data_source_id: dataSourceId, org_id: orgId, status: 'generating', source_repo_id: sourceRepoId },
      { onConflict: 'data_source_id' },
    )
}

/** A 'generating' row older than this is considered dead (task maxDuration is 3600s) — a fresh
 *  claim may take over. Mirrors kpi/service.ts EXTRACTION_RUNNING_TTL_MS. */
export const CONTEXT_GENERATING_TTL_MS = 60 * 60 * 1000

/**
 * Atomically claim the generating slot for a source, or report that a generation is already in
 * flight. Unlike markContextGenerating (unconditional — kept for the callers that ALREADY hold
 * the slot, e.g. runContextGeneration), this is the one-running-per-source guard for entry
 * points: two concurrent POSTs (ask gate + sources page, or two members) must not both clone the
 * repo and run the LLM, with the loser silently overwriting the winner's doc.
 *
 * Claim = INSERT the row (first generation) or a conditional UPDATE that only matches when the
 * row is NOT freshly 'generating' (status != generating, OR updated_at older than the TTL —
 * Postgres re-checks the predicate under the row lock, so exactly one concurrent claimer wins).
 */
export async function claimContextGenerating(
  dataSourceId: string,
  orgId: string,
  sourceRepoId: string | null,
): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return true // unconfigured local fallback — behave like the old unconditional mark
  const { error: insErr } = await admin
    .from('data_source_context')
    .insert({ data_source_id: dataSourceId, org_id: orgId, status: 'generating', source_repo_id: sourceRepoId })
  if (!insErr) return true
  if (insErr.code !== '23505') {
    console.error(`[context] claim insert failed for ${dataSourceId}:`, insErr.message)
    return false
  }
  // Two sequential AND-only conditional updates, NOT one `.or()` filter: PostgREST rejects
  // logical-operator filters on UPDATE with 42703 "column … does not exist" (verified against
  // prod 2026-07-16 — GET parses the same grammar fine). Each update is atomic, so exactly one
  // concurrent claimer can win either branch.
  const ttlCutoff = new Date(Date.now() - CONTEXT_GENERATING_TTL_MS).toISOString()
  const fresh = await admin
    .from('data_source_context')
    .update({ status: 'generating', source_repo_id: sourceRepoId })
    .eq('data_source_id', dataSourceId)
    .neq('status', 'generating')
    .select('data_source_id')
  if (fresh.error) {
    console.error(`[context] claim update failed for ${dataSourceId}:`, fresh.error.message)
    return false
  }
  if (fresh.data?.length) return true
  // still 'generating' — take over only when it's older than the TTL (a dead run)
  const stale = await admin
    .from('data_source_context')
    .update({ status: 'generating', source_repo_id: sourceRepoId })
    .eq('data_source_id', dataSourceId)
    .eq('status', 'generating')
    .lt('updated_at', ttlCutoff)
    .select('data_source_id')
  if (stale.error) {
    console.error(`[context] stale-claim update failed for ${dataSourceId}:`, stale.error.message)
    return false
  }
  return Boolean(stale.data?.length)
}

/** Mark a context row as failed without touching content_md (keeps the last-good doc injectable
 *  only if it was already fresh — but status=failed suppresses injection). */
export async function markContextFailed(dataSourceId: string, orgId: string, error: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('data_source_context')
    .upsert(
      { data_source_id: dataSourceId, org_id: orgId, status: 'failed', error: error.slice(0, 300) },
      { onConflict: 'data_source_id' },
    )
}

/** Flip a FRESH doc to 'stale' (a push landed but plan policy said don't auto-regen). Leaves
 *  generating/failed/stale rows untouched; a stale doc keeps injecting, just flagged. */
export async function markContextStale(dataSourceId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('data_source_context')
    .update({ status: 'stale' })
    .eq('data_source_id', dataSourceId)
    .eq('status', 'fresh')
}

export interface ContextPlanState {
  plan: PlanTier
  extractionsUsed: number
}

/** Inputs for the context plan policy (lib/context/policy.ts): the org's ENTITLED plan (lapsed
 *  subscriptions enforce at free, same rule as checkUsageQuota) + the lifetime tier-2 counter.
 *  Fails open on read errors / pre-migration (plan 'free', used 0 — the FIRST extraction always
 *  passes, so a deploy-before-migration never hard-blocks). */
export async function getContextPlanState(orgId: string): Promise<ContextPlanState> {
  const fallback: ContextPlanState = { plan: 'free', extractionsUsed: 0 }
  const admin = createAdminClient()
  if (!admin) return fallback
  const { data } = await admin
    .from('organizations')
    .select('plan, subscription_status, context_extractions_used')
    .eq('id', orgId)
    .limit(1)
  const row = data?.[0] as
    | { plan: string | null; subscription_status: string | null; context_extractions_used: number | null }
    | undefined
  if (!row) return fallback
  return {
    plan: entitledPlan(row.plan, row.subscription_status),
    extractionsUsed: row.context_extractions_used ?? 0,
  }
}

/** Bump the lifetime tier-2 counter (SUCCESSFUL generations only — the free slot is never
 *  consumed by a failed run). Atomic RPC, service_role. Never throws (mirrors incrementUsage);
 *  an under-count only re-grants a free extraction, it can never block a paying user. */
export async function incrementContextExtractions(orgId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { error } = await admin.rpc('increment_context_extractions', { org_id: orgId })
  if (error) {
    console.error(`[context] increment_context_extractions failed for ${orgId}:`, error.message)
    Sentry.captureMessage(`increment_context_extractions failed for org ${orgId}: ${error.message}`, 'error')
  }
}

/** Current introspection-cache hash for a source — stamped onto a generated context doc so a later
 *  schema change (different content_hash) can be detected as drift. */
export async function getCurrentSchemaHash(dataSourceId: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('data_source_schemas')
    .select('content_hash')
    .eq('data_source_id', dataSourceId)
    .limit(1)
  return (data?.[0] as { content_hash: string | null } | undefined)?.content_hash ?? null
}

/**
 * Render the context doc as a clearly-delimited TRUSTED system-prompt section. The base prompt
 * tells the model to treat tool-returned DATA as untrusted; THIS block is authored by supalens
 * (schema + app code), so it is explicitly trusted — the untrusted-runtime-data boundary stays
 * intact. Truncated to MAX_INJECT_CHARS to bound per-turn token cost.
 */
export function renderSourceContextSection(ctx: SourceContext): string {
  const body =
    ctx.contentMd.length > MAX_INJECT_CHARS
      ? ctx.contentMd.slice(0, MAX_INJECT_CHARS) + '\n\n…(context truncated for length)…'
      : ctx.contentMd
  const staleNote =
    ctx.status === 'stale'
      ? '\nNote: this context may be slightly out of date (the schema or code changed since it was generated).'
      : ''
  return `

---
DATA SOURCE CONTEXT (TRUSTED — authored by supalens from this source's schema${
    ctx.sourceRepoId ? ' and its application code' : ''
  }; rely on it to choose the right tables/columns and understand business meaning. This is NOT user-supplied runtime data.)${staleNote}

${body}
---
`
}
