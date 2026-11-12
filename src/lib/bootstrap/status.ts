// NOT `import 'server-only'` — the status shape is shared with the client component; the reader
// itself only ever runs server-side (it uses the service-role client).
//
// Progress WITHOUT a progress table: the scan's state is already persisted by the three phases it
// runs, so this derives it instead of adding a row to keep in sync. That also makes it the resume
// path — a reload, a closed tab or a second device all reconstruct the same picture from the DB.
import { requireAdminClient } from '@/utils/supabase/admin'
import { parseSupalensMd, summarizeContext } from '@/lib/context/parse'
import { latestExtraction } from '@/lib/kpi/service'
import {
  INITIAL_PROGRESS,
  MAX_ITEMS_PER_METRIC,
  type BootstrapPhase,
  type BootstrapProgress,
  type PhaseState,
} from './events'

/** How long a `running` extraction is trusted before the UI stops calling the scan "in progress".
 *  Matches the extraction TTL used by the standalone route. */
const RUNNING_TTL_MS = 60 * 60 * 1000

/** What parsing SUPALENS.md yields, once. */
interface ContextDerived {
  entities: number
  rules: number
  entityNames: string[]
  ruleTexts: string[]
}

/** Cache bound — a long-lived server must not accumulate one entry per data source ever polled. */
const CONTEXT_CACHE_MAX = 200
/** Keyed `dataSourceId:updated_at`. `null` = "this version of the row has no doc" — cached too, so
 *  the pending/generating phases (content_md still NULL) don't re-query on every tick either. */
const contextCache = new Map<string, ContextDerived | null>()

/**
 * Entity/rule counts + names from the stored SUPALENS.md.
 *
 * `getBootstrapStatus` is a 5-SECOND POLL, so nothing in it may be O(doc) per tick.
 * `parseSupalensMd` walks a document up to 24k chars, and the doc only changes when
 * `data_source_context.updated_at` moves — so the derived values are memoized on that watermark
 * and the (large) `content_md` is fetched ONLY on a miss. A doc that does not change is therefore
 * read and parsed exactly once per process; every later tick is indexed counts alone.
 */
async function deriveContext(
  admin: ReturnType<typeof requireAdminClient>,
  dataSourceId: string,
  updatedAt: string | null | undefined,
): Promise<ContextDerived | null> {
  const key = `${dataSourceId}:${updatedAt ?? ''}`
  if (contextCache.has(key)) return contextCache.get(key) ?? null

  const { data } = await admin
    .from('data_source_context')
    .select('content_md')
    .eq('data_source_id', dataSourceId)
    .limit(1)
  const md = (data?.[0] as { content_md?: string | null } | undefined)?.content_md

  const derived: ContextDerived | null = md
    ? (() => {
        const parsed = parseSupalensMd(md)
        const summary = summarizeContext(parsed)
        return {
          entities: summary.entities,
          rules: summary.rules,
          entityNames: parsed.entities.slice(0, MAX_ITEMS_PER_METRIC).map((e) => e.name),
          ruleTexts: parsed.rules.slice(0, MAX_ITEMS_PER_METRIC).map((r) => r.text),
        }
      })()
    : null

  // The key carries updated_at (bumped by trg_dsc_upd on every write), so a regenerated doc
  // simply misses and re-parses. Evict oldest first — Map preserves insertion order — rather
  // than growing one entry per data source ever polled.
  if (contextCache.size >= CONTEXT_CACHE_MAX) {
    const oldest = contextCache.keys().next().value
    if (oldest !== undefined) contextCache.delete(oldest)
  }
  contextCache.set(key, derived)
  return derived
}

export interface BootstrapStatus extends BootstrapProgress {
  /** true while any phase is still running — the UI keeps polling. */
  active: boolean
  /** Which phase a retry would start from, or null when there is nothing left. */
  resumeFrom: BootstrapPhase | null
}

function contextPhase(status: string | null | undefined): PhaseState {
  switch (status) {
    case 'fresh':
    case 'stale':
      return 'done'
    case 'generating':
      return 'running'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

/**
 * Reconstruct the scan's progress for a data source from persisted state.
 *
 * Counts are read, never guessed: `tables` is the row count the introspection cache actually
 * wrote, `entities`/`rules` come from parsing the stored SUPALENS.md, and `kpis` is the live
 * catalog count (the extraction upserts each proposal as it validates it, which is what makes the
 * number climb during a run).
 */
export async function getBootstrapStatus(dataSourceId: string): Promise<BootstrapStatus> {
  const admin = requireAdminClient()

  const [objects, ctxRows, extraction, kpiRows] = await Promise.all([
    admin.from('data_source_objects').select('id', { count: 'exact', head: true }).eq('data_source_id', dataSourceId),
    // NOT content_md: the doc is up to 24k chars and this runs every 5s. Only its watermark is
    // read here; deriveContext fetches the body on a cache miss.
    admin.from('data_source_context').select('status, error, updated_at').eq('data_source_id', dataSourceId).limit(1),
    latestExtraction(dataSourceId).catch(() => null),
    // The catalog can hold dozens of proposals; the strip shows 12 names and a total. Ask the DB
    // for the total (exact count) and only the rows actually rendered.
    admin
      .from('kpi_catalog')
      .select('title', { count: 'exact' })
      .eq('data_source_id', dataSourceId)
      .limit(MAX_ITEMS_PER_METRIC),
  ])

  const tableCount = objects.count ?? null
  const ctx = ctxRows.data?.[0] as { status?: string; error?: string | null; updated_at?: string | null } | undefined

  const progress: BootstrapProgress = {
    ...INITIAL_PROGRESS,
    phases: { ...INITIAL_PROGRESS.phases },
    counts: { ...INITIAL_PROGRESS.counts },
    items: { entities: [], rules: [], kpis: [] },
  }

  // schema — the cache having rows IS the evidence the phase ran.
  progress.counts.tables = tableCount
  progress.phases.schema = tableCount != null && tableCount > 0 ? 'done' : 'pending'

  // understanding
  progress.phases.context = contextPhase(ctx?.status)
  if (ctx) {
    const derived = await deriveContext(admin, dataSourceId, ctx.updated_at)
    if (derived) {
      progress.counts.entities = derived.entities
      progress.counts.rules = derived.rules
      progress.items.entities = derived.entityNames
      progress.items.rules = derived.ruleTexts
    }
  }
  if (progress.phases.context === 'failed') progress.error = ctx?.error ?? 'failed'

  // KPI proposals — count from the DB, names from the (capped) rows.
  const titles = ((kpiRows.data ?? []) as { title: string }[]).map((r) => r.title)
  const kpiCount = kpiRows.count ?? titles.length
  progress.counts.kpis = kpiCount > 0 ? kpiCount : progress.phases.kpi === 'done' ? 0 : null
  progress.items.kpis = titles

  if (extraction) {
    const age = Date.now() - new Date(extraction.createdAt).getTime()
    if (extraction.status === 'running') {
      progress.phases.kpi = age < RUNNING_TTL_MS ? 'running' : 'failed'
      if (progress.phases.kpi === 'failed') progress.error = 'timed out'
    } else if (extraction.status === 'completed') {
      progress.phases.kpi = 'done'
      progress.counts.kpis = extraction.proposedCount ?? titles.length
    } else if (extraction.status === 'failed') {
      progress.phases.kpi = 'failed'
      progress.error = extraction.error ?? 'failed'
    }
    progress.startedAt = new Date(extraction.createdAt).getTime()
    if (extraction.completedAt) progress.finishedAt = new Date(extraction.completedAt).getTime()
  }

  const active = progress.phases.context === 'running' || progress.phases.kpi === 'running'
  const order: BootstrapPhase[] = ['schema', 'context', 'kpi']
  const resumeFrom = order.find((p) => progress.phases[p] !== 'done' && progress.phases[p] !== 'skipped') ?? null

  return { ...progress, active, resumeFrom }
}
