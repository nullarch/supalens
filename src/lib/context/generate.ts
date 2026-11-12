// NOT `import 'server-only'` — runs on the Trigger.dev host (clone + subprocess).
// tier-2 context generator: reuses the code-analysis agent VERBATIM (same clone + jailed file
// tools + read-only SQL tools + lockdown) — we just hand it a context-authoring directive as the
// "question" and persist its final Markdown to data_source_context instead of a Q&A run record.
// Binding dataSourceId turns on the read-only SQL tools + CROSS_DB_ADDENDUM, so the agent sees
// BOTH the code and the live schema — that is what makes the doc code-aware ("the code is context").
import { runCodeAnalysis, type CodeChunk } from '@/lib/code-agent/run-code-analysis'
import {
  markContextGenerating,
  markContextFailed,
  putSourceContext,
  getCurrentSchemaHash,
  incrementContextExtractions,
} from './service'
import { incrementUsage } from '@/lib/plans/usage'

export const CONTEXT_GEN_PROMPT = `Your task is to author SUPALENS.md — a durable CONTEXT DOCUMENT for this data source that another AI data analyst will read (as trusted context) BEFORE it writes queries against the database. You have read-only access to the application's source code (file tools) and, when available, to the live database (schema/query tools). Investigate how this codebase uses the database, then produce a single Markdown document.

Cover, in this order:
1. Overview — what the app/domain is (1-3 sentences) and the database engine.
2. Entity ↔ table/collection map — for each important model/entity in the code, the table/collection it maps to (from ORM models, migrations, schema files).
3. Key tables/columns — the business meaning of the important tables and their key columns (what they represent; units; currency; timezone).
4. Enum / status / coded values — the MEANING of coded columns (e.g. status = 1 → "pending"), extracted from the code (constants, enums, mappings). This is the HIGHEST-VALUE section: a bare schema cannot provide it.
5. Relationships & join patterns — foreign keys and how the code actually joins/relates tables.
6. Common query patterns & important filters — recurring WHERE clauses (tenant scoping, soft-delete, active flags) and hot query paths.
7. Gotchas — anything non-obvious an analyst must know (soft deletes, denormalized counters, cents vs dollars, UTC storage, sharding).

Rules:
- Ground EVERY claim in the code or schema you actually inspected. Do NOT invent tables, columns, or enum meanings. If you cannot confirm something, write "unconfirmed".
- Prefer the code's own terminology and the REAL column names.
- Be thorough but tight — this document is re-sent to the analyst on every query, so keep it focused on what improves query accuracy (aim for well under 1500 lines).
- OUTPUT ONLY THE MARKDOWN DOCUMENT — no preamble, no "here is", no closing remarks. Start with a single top-level "# " heading.`

export interface GenerateContextArgs {
  dataSourceId: string
  orgId: string
  runId: string
  repoId: string
  /** "owner/repo" */
  fullName: string
  /** installation access token (~1h), used only for the clone. */
  token: string
  ref?: string
  sparsePaths?: string[]
  /** enable read-only SQL DB tools alongside the code tools (SQL engines only; false for Firestore,
   *  whose SQL tools don't apply — that run is code-only). */
  withDb: boolean
  userId?: string
  model?: string
  maxTurns?: number
  emit?: (chunk: CodeChunk) => void | Promise<void>
}

/**
 * Clone the attached repo, run the code × DB agent with the context-authoring directive, and
 * persist the resulting SUPALENS.md to data_source_context. On failure the last-good doc is
 * preserved (status flips to 'failed'; content_md is left untouched).
 */
export async function runContextGeneration(args: GenerateContextArgs): Promise<{ ok: boolean; error?: string }> {
  await markContextGenerating(args.dataSourceId, args.orgId, args.repoId)

  const result = await runCodeAnalysis({
    runId: args.runId,
    fullName: args.fullName,
    token: args.token,
    question: CONTEXT_GEN_PROMPT,
    ref: args.ref,
    sparsePaths: args.sparsePaths,
    // SQL engines: bind the data source so the agent also gets read-only execute_sql/get_schema
    // (+ CROSS_DB_ADDENDUM). Firestore: code-only — SQL tools don't apply to a document store.
    dataSourceId: args.withDb ? args.dataSourceId : undefined,
    model: args.model,
    maxTurns: args.maxTurns ?? 40,
    emit: args.emit,
  })

  if (result.ok && result.text.trim()) {
    await putSourceContext({
      dataSourceId: args.dataSourceId,
      orgId: args.orgId,
      contentMd: result.text.trim(),
      status: 'fresh',
      sourceRepoId: args.repoId,
      schemaHash: await getCurrentSchemaHash(args.dataSourceId), // stamp for later drift detection
      model: args.model ?? null,
      generatedBy: args.userId ?? null,
    })
    // Meter tier-2 context gen like any other LLM run (1 query + tokens) so it isn't a free,
    // unmetered path once billing is active. incrementUsage never throws.
    await incrementUsage(args.orgId, 1, result.tokensIn + result.tokensOut)
    // Lifetime plan counter (free = 1 extraction on the house) — success only, so a failed run
    // never consumes the free slot. Counted even pre-billing so the data is right when it flips on.
    await incrementContextExtractions(args.orgId)
    return { ok: true }
  }

  await markContextFailed(args.dataSourceId, args.orgId, result.error ?? 'no content produced')
  return { ok: false, error: result.error }
}
