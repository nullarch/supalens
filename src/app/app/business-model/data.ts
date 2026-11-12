/**
 * Server-side loaders for the Business Model screens.
 *
 * The context doc is read with the CALLER's client (member-read RLS `dsc_sel`), so a member can
 * only ever see their own org's understanding. The KPI catalog is read through the service-role
 * client (`lib/kpi/service.ts` — the table is member-read under RLS but absent from the generated
 * types), scoped to data-source ids the caller's RLS already returned.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { parseSupalensMd, summarizeContext, type ParsedContext } from '@/lib/context/parse'

type Client = Pick<SupabaseClient, 'from'>

export interface SourceRow {
  id: string
  name: string
  engine: string
  isDemo: boolean
  repoId: string | null
}

export interface ContextRow {
  dataSourceId: string
  contentMd: string | null
  /** Raw stored status; `resolveContextState` applies read-time schema drift on top. */
  status: string | null
  generatedAt: string | null
  generatedBy: string | null
  sourceRepoId: string | null
  generatedFromSha: string | null
  schemaHash: string | null
  model: string | null
  error: string | null
}

export type ContextState = 'fresh' | 'stale' | 'generating' | 'failed' | 'none'

/**
 * Read-time schema drift: a 'fresh' doc whose stamped `schema_hash` no longer matches the current
 * introspection hash is effectively stale — the schema moved under it. Mirrors `/app/sources`.
 */
export function resolveContextState(
  ctx: Pick<ContextRow, 'status' | 'schemaHash'> | undefined,
  currentSchemaHash: string | null | undefined,
): ContextState {
  if (!ctx || !ctx.status) return 'none'
  if (ctx.status === 'fresh' && ctx.schemaHash && currentSchemaHash && ctx.schemaHash !== currentSchemaHash) {
    return 'stale'
  }
  if (ctx.status === 'fresh' || ctx.status === 'stale' || ctx.status === 'generating' || ctx.status === 'failed') {
    return ctx.status
  }
  return 'none' // 'pending' and anything unknown read as "not generated yet"
}

/** A doc that was never written has no content — treat it as absent even if a row exists. */
export function hasDoc(ctx: ContextRow | undefined): boolean {
  return Boolean(ctx?.contentMd && ctx.contentMd.trim())
}

export async function loadSources(client: Client, orgId: string): Promise<SourceRow[]> {
  const { data } = await client
    .from('data_sources')
    .select('id, name, engine, is_demo, repo_id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  return ((data ?? []) as Array<{ id: string; name: string; engine: string; is_demo: boolean; repo_id: string | null }>).map(
    (r) => ({ id: r.id, name: r.name, engine: r.engine, isDemo: r.is_demo, repoId: r.repo_id }),
  )
}

export async function loadContexts(client: Client, ids: string[]): Promise<Map<string, ContextRow>> {
  const out = new Map<string, ContextRow>()
  if (ids.length === 0) return out
  const { data } = await client
    .from('data_source_context')
    .select(
      'data_source_id, content_md, status, generated_at, generated_by, source_repo_id, generated_from_sha, schema_hash, model, error',
    )
    .in('data_source_id', ids)
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    out.set(String(r.data_source_id), {
      dataSourceId: String(r.data_source_id),
      contentMd: (r.content_md as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      generatedAt: (r.generated_at as string | null) ?? null,
      generatedBy: (r.generated_by as string | null) ?? null,
      sourceRepoId: (r.source_repo_id as string | null) ?? null,
      generatedFromSha: (r.generated_from_sha as string | null) ?? null,
      schemaHash: (r.schema_hash as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    })
  }
  return out
}

/** Current introspection hash per source — the other half of the drift check. */
export async function loadSchemaHashes(client: Client, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (ids.length === 0) return out
  const { data } = await client
    .from('data_source_schemas')
    .select('data_source_id, content_hash')
    .in('data_source_id', ids)
  for (const r of (data ?? []) as Array<{ data_source_id: string; content_hash: string | null }>) {
    out.set(r.data_source_id, r.content_hash)
  }
  return out
}

export interface BusinessModelRow extends SourceRow {
  state: ContextState
  tier: 'repo' | 'schema' | null
  generatedAt: string | null
  counts: ReturnType<typeof summarizeContext> | null
}

/** Index-row projection: parse each doc once for its entity/rule/metric counts. */
export function toRows(
  sources: SourceRow[],
  contexts: Map<string, ContextRow>,
  schemaHashes: Map<string, string | null>,
): BusinessModelRow[] {
  return sources.map((src) => {
    const ctx = contexts.get(src.id)
    const state = resolveContextState(ctx, schemaHashes.get(src.id))
    const doc = hasDoc(ctx) ? parseSupalensMd(ctx!.contentMd!) : null
    return {
      ...src,
      state,
      tier: doc ? (ctx?.sourceRepoId ? 'repo' : doc.looksBaseline ? 'schema' : 'repo') : null,
      generatedAt: ctx?.generatedAt ?? null,
      counts: doc ? summarizeContext(doc) : null,
    }
  })
}

export type { ParsedContext }
