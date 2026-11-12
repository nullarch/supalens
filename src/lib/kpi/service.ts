// NOT `import 'server-only'` — this module is read AND written on the agent host (Trigger.dev
// runtime), exactly like src/lib/context/service.ts and src/utils/supabase/admin.ts. It uses the
// UNTYPED service-role admin client (kpi_catalog / kpi_extractions are member-read /
// service_role-write, and aren't in the generated types yet, so the untyped client is required to
// query them). requireAdminClient() throws a clear error when the service-role env is missing —
// every KPI path genuinely requires the DB, so there is no meaningful degrade-to-no-op here.
import { requireAdminClient } from '@/utils/supabase/admin'
import { alertConfigOf, noMonitorOf } from '@/lib/kpi/types'
import type {
  KpiCatalogRow,
  KpiCategory,
  KpiEvidence,
  KpiExtractionRow,
  KpiExtractionStatus,
  KpiProposal,
  KpiRowStatus,
} from '@/lib/kpi/types'
import type { VisualizationSpec } from '@/lib/viz/spec'

// ── DB row shapes (snake_case; the admin client is untyped so we shape them locally) ──────
interface KpiCatalogDbRow {
  id: string
  org_id: string
  data_source_id: string
  extraction_id: string | null
  key: string
  title: string
  category: string
  description: string | null
  importance: number
  metric_sql: string
  viz_spec: unknown
  alert_config: unknown
  evidence: unknown
  status: string
  applied: unknown
  created_at: string
  updated_at: string
}

interface KpiExtractionDbRow {
  id: string
  org_id: string
  data_source_id: string
  status: string
  tier: number
  proposed_count: number | null
  error: string | null
  trigger_run_id: string | null
  created_at: string
  completed_at: string | null
}

// ── Extraction run lifecycle ──────────────────────────────────────────────────────────────

/**
 * How long a 'running' extraction blocks a re-trigger before it's treated as stuck. MUST be >= the
 * extract-kpis task's maxDuration (3600s) — a shorter TTL let a legit long tier-2 run stop blocking
 * and get double-triggered (duplicate cost + double increment). Shared by the extract route + MCP.
 */
export const EXTRACTION_RUNNING_TTL_MS = 60 * 60 * 1000

/** Thrown by createExtraction when the one-running-per-source unique index rejects a concurrent
 *  insert — callers translate it to a 409 "already in progress" (closes the read-then-insert race). */
export const EXTRACTION_ALREADY_RUNNING = 'extraction_already_running'

/** Insert a new extraction run in the 'running' state; returns its id for status updates. */
export async function createExtraction(args: {
  orgId: string
  dataSourceId: string
  tier: 1 | 2
  createdBy?: string
  triggerRunId?: string
}): Promise<{ id: string }> {
  const db = requireAdminClient()
  const { data, error } = await db
    .from('kpi_extractions')
    .insert({
      org_id: args.orgId,
      data_source_id: args.dataSourceId,
      status: 'running',
      tier: args.tier,
      created_by: args.createdBy ?? null,
      trigger_run_id: args.triggerRunId ?? null,
    })
    .select('id')
    .limit(1)
  if (error) {
    // 23505 = the `one running per source` partial unique index tripped by a concurrent trigger.
    if ((error as { code?: string }).code === '23505') throw new Error(EXTRACTION_ALREADY_RUNNING)
    throw new Error(`[kpi] createExtraction failed: ${error.message}`)
  }
  const id = (data?.[0] as { id: string } | undefined)?.id
  if (!id) throw new Error('[kpi] createExtraction returned no id')
  return { id }
}

/** Mark an extraction completed with the number of proposals it produced. */
export async function completeExtraction(id: string, proposedCount: number): Promise<void> {
  const db = requireAdminClient()
  const { error } = await db
    .from('kpi_extractions')
    .update({ status: 'completed', proposed_count: proposedCount, completed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`[kpi] completeExtraction failed: ${error.message}`)
}

/** Mark an extraction failed; the error string is truncated to keep the column bounded. */
export async function failExtraction(id: string, error: string): Promise<void> {
  const db = requireAdminClient()
  const { error: dbError } = await db
    .from('kpi_extractions')
    .update({ status: 'failed', error: error.slice(0, 500), completed_at: new Date().toISOString() })
    .eq('id', id)
  if (dbError) throw new Error(`[kpi] failExtraction failed: ${dbError.message}`)
}

/** Stamp the Trigger.dev run id onto an extraction (observability; set once the run is dispatched). */
export async function setExtractionTriggerRunId(id: string, triggerRunId: string): Promise<void> {
  const db = requireAdminClient()
  const { error } = await db
    .from('kpi_extractions')
    .update({ trigger_run_id: triggerRunId })
    .eq('id', id)
  if (error) throw new Error(`[kpi] setExtractionTriggerRunId failed: ${error.message}`)
}

// ── Proposals ───────────────────────────────────────────────────────────────────────────

/**
 * Re-extraction status transition. A dismissed/accepted KPI keeps its status (and, for an
 * accepted one, its applied dashboard/alert — because `applied` is omitted from the upsert
 * payload, so the existing value is preserved). New / previously-proposed / stale keys
 * (re)surface as 'proposed'.
 */
function nextStatus(existing: KpiRowStatus | undefined): KpiRowStatus {
  if (existing === 'dismissed' || existing === 'accepted') return existing
  return 'proposed'
}

/**
 * Upsert a batch of proposals by (data_source_id, key). One SELECT to learn existing statuses,
 * then a single batched upsert: new keys insert as 'proposed'; existing 'proposed'/'stale' keys
 * refresh their content and reset to 'proposed'; existing 'dismissed'/'accepted' keys refresh
 * their content but PRESERVE status (and, for accepted, `applied`, which is not written here).
 * Idempotent, so no DB transaction is needed.
 */
export async function upsertProposals(args: {
  orgId: string
  dataSourceId: string
  extractionId: string
  proposals: KpiProposal[]
}): Promise<{ upserted: number }> {
  if (args.proposals.length === 0) return { upserted: 0 }
  const db = requireAdminClient()

  // 1) existing keys + statuses for this source
  const { data: existing, error: selError } = await db
    .from('kpi_catalog')
    .select('key, status')
    .eq('data_source_id', args.dataSourceId)
  if (selError) throw new Error(`[kpi] upsertProposals (fetch existing) failed: ${selError.message}`)
  const existingByKey = new Map<string, KpiRowStatus>(
    ((existing ?? []) as { key: string; status: KpiRowStatus }[]).map((r) => [r.key, r.status]),
  )

  // 2) one batched upsert (content columns + the computed status; `applied` intentionally omitted
  //    so an accepted KPI keeps its wired dashboard/alert untouched)
  const now = new Date().toISOString()
  const rows = args.proposals.map((p) => ({
    org_id: args.orgId,
    data_source_id: args.dataSourceId,
    extraction_id: args.extractionId,
    key: p.key,
    title: p.title,
    category: p.category,
    description: p.description,
    importance: p.importance,
    metric_sql: p.metricSql,
    viz_spec: p.vizSpec,
    alert_config: p.alertConfig ?? p.noMonitor ?? null,
    evidence: p.evidence,
    status: nextStatus(existingByKey.get(p.key)),
    updated_at: now,
  }))
  const { error: upsertError } = await db
    .from('kpi_catalog')
    .upsert(rows, { onConflict: 'data_source_id,key' })
  if (upsertError) throw new Error(`[kpi] upsertProposals failed: ${upsertError.message}`)
  return { upserted: rows.length }
}

/**
 * Upsert a SINGLE proposal as the agent registers it, so the review UI's count climbs live during a
 * run (the browser poll reads kpi_catalog every few seconds). Applies the same per-key status rule
 * as upsertProposals and likewise omits `applied` so an accepted KPI keeps its wired artifacts.
 * Best-effort by contract: the caller wraps it in try/catch and the end-of-run batch upsert stays
 * authoritative, so a transient failure here never loses a proposal.
 */
export async function upsertProposal(args: {
  orgId: string
  dataSourceId: string
  extractionId: string
  proposal: KpiProposal
}): Promise<void> {
  const db = requireAdminClient()
  const p = args.proposal
  const { data: existing } = await db
    .from('kpi_catalog')
    .select('status')
    .eq('data_source_id', args.dataSourceId)
    .eq('key', p.key)
    .limit(1)
  const prevStatus = (existing?.[0] as { status: KpiRowStatus } | undefined)?.status
  const { error } = await db.from('kpi_catalog').upsert(
    {
      org_id: args.orgId,
      data_source_id: args.dataSourceId,
      extraction_id: args.extractionId,
      key: p.key,
      title: p.title,
      category: p.category,
      description: p.description,
      importance: p.importance,
      metric_sql: p.metricSql,
      viz_spec: p.vizSpec,
      alert_config: p.alertConfig ?? p.noMonitor ?? null,
      evidence: p.evidence,
      status: nextStatus(prevStatus),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'data_source_id,key' },
  )
  if (error) throw new Error(`[kpi] upsertProposal failed: ${error.message}`)
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────

function mapCatalogRow(r: KpiCatalogDbRow): KpiCatalogRow {
  return {
    id: r.id,
    orgId: r.org_id,
    dataSourceId: r.data_source_id,
    extractionId: r.extraction_id ?? null,
    key: r.key,
    title: r.title,
    category: r.category as KpiCategory,
    description: r.description ?? null,
    importance: r.importance,
    metricSql: r.metric_sql,
    vizSpec: r.viz_spec as VisualizationSpec,
    alertConfig: alertConfigOf(r.alert_config),
    noMonitor: noMonitorOf(r.alert_config),
    evidence: (r.evidence ?? []) as KpiEvidence[],
    status: r.status as KpiRowStatus,
    applied: (r.applied ?? null) as KpiCatalogRow['applied'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapExtractionRow(r: KpiExtractionDbRow): KpiExtractionRow {
  return {
    id: r.id,
    orgId: r.org_id,
    dataSourceId: r.data_source_id,
    status: r.status as KpiExtractionStatus,
    tier: r.tier as 1 | 2,
    proposedCount: r.proposed_count ?? null,
    error: r.error ?? null,
    triggerRunId: r.trigger_run_id ?? null,
    createdAt: r.created_at,
    completedAt: r.completed_at ?? null,
  }
}

/** All catalog rows for a source, grouped-ready: category asc, then importance desc. */
export async function listKpis(dataSourceId: string): Promise<KpiCatalogRow[]> {
  const db = requireAdminClient()
  const { data, error } = await db
    .from('kpi_catalog')
    .select('*')
    .eq('data_source_id', dataSourceId)
    .order('category', { ascending: true })
    .order('importance', { ascending: false })
  if (error) throw new Error(`[kpi] listKpis failed: ${error.message}`)
  return ((data ?? []) as KpiCatalogDbRow[]).map(mapCatalogRow)
}

/**
 * Lightweight status tally for a source — powers the ◆ KPI 카탈로그 chip on /app/sources without
 * pulling every row's viz_spec/sample (which listKpis does). Selects only `status`, counts in JS.
 */
export async function countKpisByStatus(
  dataSourceId: string,
): Promise<{ proposed: number; accepted: number; dismissed: number; stale: number; total: number }> {
  const db = requireAdminClient()
  const { data, error } = await db.from('kpi_catalog').select('status').eq('data_source_id', dataSourceId)
  if (error) throw new Error(`[kpi] countKpisByStatus failed: ${error.message}`)
  const counts = { proposed: 0, accepted: 0, dismissed: 0, stale: 0, total: 0 }
  for (const r of (data ?? []) as { status: string }[]) {
    counts.total += 1
    if (r.status === 'proposed' || r.status === 'accepted' || r.status === 'dismissed' || r.status === 'stale') {
      counts[r.status] += 1
    }
  }
  return counts
}

/** Most recent extraction run for a source, or null. Uses .order().limit(1) (house rule: no .single()). */
export async function latestExtraction(dataSourceId: string): Promise<KpiExtractionRow | null> {
  const db = requireAdminClient()
  const { data, error } = await db
    .from('kpi_extractions')
    .select('*')
    .eq('data_source_id', dataSourceId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`[kpi] latestExtraction failed: ${error.message}`)
  const row = data?.[0] as KpiExtractionDbRow | undefined
  return row ? mapExtractionRow(row) : null
}

// ── Status transitions (review / apply) ───────────────────────────────────────────────────

/** Set status for a set of catalog rows, scoped to a single source (accept / dismiss / restore). */
export async function setKpiStatus(args: {
  ids: string[]
  dataSourceId: string
  status: 'accepted' | 'dismissed' | 'proposed'
}): Promise<void> {
  if (args.ids.length === 0) return
  const db = requireAdminClient()
  const { error } = await db
    .from('kpi_catalog')
    .update({ status: args.status })
    .eq('data_source_id', args.dataSourceId)
    .in('id', args.ids)
  if (error) throw new Error(`[kpi] setKpiStatus failed: ${error.message}`)
}

/** Record the wired-up artifacts for a KPI and flip it to 'accepted' (called after apply). */
export async function markApplied(
  id: string,
  applied: { dashboardId?: string; widgetId?: string; savedQueryId?: string; alertId?: string },
): Promise<void> {
  const db = requireAdminClient()
  const { error } = await db
    .from('kpi_catalog')
    .update({ applied, status: 'accepted' })
    .eq('id', id)
  if (error) throw new Error(`[kpi] markApplied failed: ${error.message}`)
}

/**
 * Staleness loop: when a repo changes (push webhook), mark still-'proposed' KPIs of every live
 * data source attached to that repo as 'stale'. Two queries because the untyped admin client
 * can't express an IN (subquery). Best-effort count of affected rows.
 */
export async function markProposalsStaleForRepo(repoId: string): Promise<number> {
  const db = requireAdminClient()
  const { data: sources, error: srcError } = await db
    .from('data_sources')
    .select('id')
    .eq('repo_id', repoId)
    .is('deleted_at', null)
  if (srcError) throw new Error(`[kpi] markProposalsStaleForRepo (fetch sources) failed: ${srcError.message}`)
  const ids = ((sources ?? []) as { id: string }[]).map((s) => s.id)
  if (ids.length === 0) return 0
  const { data: updated, error: updError } = await db
    .from('kpi_catalog')
    .update({ status: 'stale' })
    .eq('status', 'proposed')
    .in('data_source_id', ids)
    .select('id')
  if (updError) throw new Error(`[kpi] markProposalsStaleForRepo failed: ${updError.message}`)
  return ((updated ?? []) as { id: string }[]).length
}
