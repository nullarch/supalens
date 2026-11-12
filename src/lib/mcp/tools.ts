import { appOrigin } from '@/config/edition'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { z } from 'zod'

import { assertReadOnly, executeReadOnly, getSchema, rlsSchemaNote } from '@/lib/query'
import { resolveUserLocale } from '@/lib/i18n/resolve-locale'
import type { Actor } from '@/lib/secrets/service'
import { ChartSpec, VisualizationSpec, withoutSample } from '@/lib/viz/spec'
import { buildWidgetSpec, defaultGridSize } from '@/lib/dashboards/build-widget'
import { requireAdminClient } from '@/utils/supabase/admin'
import { checkUsageQuota, enforceResourceLimit, planLimitFor } from '@/lib/plans/usage'
import { taskIdForEngine } from '@/lib/agent/engine'
import { createAgentRun } from '@/lib/agent/create-run'
import { isDocumentEngine, isSqlEngine } from '@/lib/data-sources/engines'
import { applyKpis } from '@/lib/kpi/apply'
import { createExtraction, failExtraction, latestExtraction, listKpis, setExtractionTriggerRunId, EXTRACTION_RUNNING_TTL_MS, EXTRACTION_ALREADY_RUNNING } from '@/lib/kpi/service'
import type { KpiCatalogRow } from '@/lib/kpi/types'
import { legacyColumnsFor, MonitorCondition } from '@/lib/alerts/condition'
import { checkGoalSeries, DAILY_SERIES_EXAMPLE } from '@/lib/alerts/goal-series'
import { ANOMALY_SERIES_MAX } from '@/lib/alerts/evaluate'
import { readOrgTimezone } from '@/lib/org/timezone'

import { assertMcpWriteAllowed, type McpAuthContext } from './auth'
import { persistableError } from '@/lib/supabase-oauth/errors'

const APP_URL = appOrigin()
const MAX_WIDGETS = 30


/**
 * Payload contract for the `extract-kpis` Trigger.dev task — declared locally (never imported from
 * trigger/, mirroring the extract BFF route) and field-for-field identical to
 * trigger/extract-kpis.ts's ExtractKpisPayload. Repo fields are present only for a tier-2 run.
 */
interface ExtractKpisPayload {
  orgId: string
  dataSourceId: string
  extractionId: string
  tier: 1 | 2
  userId?: string
  repoId?: string
  installationId?: number
  fullName?: string
  ref?: string
  sparsePaths?: string[]
}

/** Firestore where-clause shape for the document MCP tools (mirrors the agent's). */
const FirestoreWhere = z.object({
  field: z.string().describe('document field; dot notation for nested (e.g. "address.city")'),
  op: z.enum(['<', '<=', '==', '!=', '>=', '>', 'array-contains', 'in', 'not-in', 'array-contains-any']),
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()]))]),
})

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
type Extra = RequestHandlerExtra<never, never>

const ok = (data: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })
const err = (message: string): TextResult => ({ content: [{ type: 'text', text: message }], isError: true })

/**
 * MCP `create_alert` with a goal `condition`: run the metric once through the guarded engine, prove
 * it is a daily series the runner can evaluate (goal-series.ts — the same check the drafting agent
 * passes), then insert with the legacy columns derived from the rule. Returns the backtest so the
 * calling model can tell the user how often this rule would have fired.
 */
async function createGoalAlert(
  ctx: McpAuthContext,
  a: { name: string; metricSql: string; dataSourceId?: string; description?: string; goal?: string; condition: MonitorCondition },
): Promise<TextResult> {
  const dsId = await resolveSqlDataSourceId(ctx.orgId, a.dataSourceId)
  const admin = requireAdminClient()
  let res
  try {
    res = await executeReadOnly(dsId, a.metricSql, { actor: actorOf(ctx), maxRows: ANOMALY_SERIES_MAX, timeoutMs: 30_000 })
  } catch (e) {
    return err(`metricSql failed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}. Example shape: ${DAILY_SERIES_EXAMPLE}`)
  }
  const { timezone } = await readOrgTimezone(admin, ctx.orgId)
  const checked = checkGoalSeries(res.columns, res.rows, a.condition, Date.now(), timezone)
  if (!checked.ok) return err(checked.error)
  const cap = await enforceResourceLimit(ctx.orgId, 'alerts_per_org', {
    table: 'alerts',
    label: 'alert',
    softDelete: true,
    filters: [{ column: 'org_id', value: ctx.orgId }],
  })
  if (!cap.ok) return err(cap.error)
  const { data, error } = await admin
    .from('alerts')
    .insert({
      org_id: ctx.orgId,
      data_source_id: dsId,
      name: a.name,
      description: a.description ?? null,
      metric_sql: a.metricSql,
      ...legacyColumnsFor(a.condition),
      goal: a.goal?.trim().slice(0, 500) || null,
      condition: a.condition,
    })
    .select('id')
    .limit(1)
  if (error) return err(error.message)
  const { points, current, backtest } = checked.check
  return ok({
    id: (data?.[0] as { id: string } | undefined)?.id,
    created: true,
    strategy: a.condition.strategy,
    current: { day: points[points.length - 1]?.bucket, value: current.latest, wouldFireNow: current.met, expectedLower: current.lower, expectedUpper: current.upper },
    backtest: { days: points.length, evaluated: backtest.evaluated, fires: backtest.fires, firedOn: backtest.firedIndices.map((i) => points[i]?.bucket) },
  })
}

/** Pull the verified org context off the request. Throws → surfaced as an MCP error. */
function ctxOf(extra: Extra): McpAuthContext {
  const c = extra.authInfo?.extra as McpAuthContext | undefined
  if (!c?.orgId) throw new Error('unauthorized: missing org context')
  return c
}

const actorOf = (ctx: McpAuthContext): Actor => ({ kind: 'mcp_token', id: ctx.apiKeyId })

/** Normalize a free-text provenance string into the saved_queries.source jsonb shape. */
const provenance = (source?: string): { origin: string } | null => (source ? { origin: source } : null)

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'dashboard'
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Find a dashboard by id (when ref is a uuid) or slug, scoped to the org. Avoids `.or` filter injection. */
async function findDashboardId(orgId: string, ref: string): Promise<string | null> {
  const admin = requireAdminClient()
  const q = admin.from('dashboards').select('id').eq('org_id', orgId).is('deleted_at', null).limit(1)
  const { data } = await (UUID_RE.test(ref) ? q.eq('id', ref) : q.eq('slug', ref))
  return (data?.[0] as { id: string } | undefined)?.id ?? null
}

/**
 * Resolve + authorize a data source id against the caller's org. This is the tenant
 * boundary: the model can pass any id, but it only ever resolves to a source THIS org
 * owns. With no id and a single source, it defaults; with several, it asks the model to pick.
 */
async function resolveDataSourceId(orgId: string, given?: string): Promise<string> {
  const admin = requireAdminClient()
  if (given) {
    const { data } = await admin
      .from('data_sources')
      .select('id')
      .eq('id', given)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .limit(1)
    if (!data?.length) throw new Error(`data source "${given}" not found in your workspace`)
    return given
  }
  const { data } = await admin
    .from('data_sources')
    .select('id, name')
    .eq('org_id', orgId)
    .is('deleted_at', null)
  const rows = (data ?? []) as { id: string; name: string }[]
  if (rows.length === 0)
    throw new Error(`No data source connected. Connect one at ${APP_URL}/app/sources`)
  if (rows.length > 1)
    throw new Error(
      `Multiple data sources — pass dataSourceId. Options: ${rows.map((r) => `${r.name} (${r.id})`).join(', ')}`
    )
  return rows[0].id
}

/**
 * Resolve + authorize a data source id AND assert it is a SQL engine (postgres/mysql). Firestore
 * (document) sources have no SQL surface, so the SQL-shaped tools reject them with a clear message
 * pointing to `ask` — instead of failing deep in the query engine with an opaque credential error.
 */
async function resolveSqlDataSourceId(orgId: string, given?: string): Promise<string> {
  const dsId = await resolveDataSourceId(orgId, given)
  const { data } = await requireAdminClient().from('data_sources').select('engine').eq('id', dsId).limit(1)
  const engine = (data?.[0] as { engine?: string } | undefined)?.engine
  // whitelist, not `!== 'firestore'` — a future non-SQL engine must fail HERE with a clear
  // message, not deep in the query engine with an opaque credential error
  if (!isSqlEngine(engine)) {
    throw new Error(
      engine === 'firestore'
        ? `Data source "${dsId}" is a Firestore (document) database — it has no SQL interface. Use the \`ask\` tool for natural-language analysis instead.`
        : `Data source "${dsId}" is not a SQL database (engine=${engine ?? 'unknown'}) — the SQL tools do not apply. Use the \`ask\` tool instead.`
    )
  }
  return dsId
}

/** Inverse of resolveSqlDataSourceId: resolve + assert the source IS a document engine (Firestore tools). */
async function resolveFirestoreDataSourceId(orgId: string, given?: string): Promise<string> {
  const dsId = await resolveDataSourceId(orgId, given)
  const { data } = await requireAdminClient().from('data_sources').select('engine').eq('id', dsId).limit(1)
  const engine = (data?.[0] as { engine?: string } | undefined)?.engine
  if (!isDocumentEngine(engine)) {
    throw new Error(
      `Data source "${dsId}" is a SQL database (${engine ?? 'unknown'}), not Firestore. Use execute_sql / get_schema for it.`
    )
  }
  return dsId
}

/**
 * Token hygiene for list_kpis: the DB keeps the full preview sample, but the model only needs a
 * taste — trim each KPI's viz_spec.sample to at most 3 rows in the tool output (the DB is untouched).
 */
function trimKpiSample(k: KpiCatalogRow): KpiCatalogRow {
  const sample = k.vizSpec?.sample
  if (!sample || sample.rows.length <= 3) return k
  return { ...k, vizSpec: { ...k.vizSpec, sample: { ...sample, rows: sample.rows.slice(0, 3) } } }
}

export function registerSupalensTools(server: McpServer): void {
  // ── orientation ─────────────────────────────────────────────────────────
  server.registerTool(
    'get_setup_status',
    {
      title: 'Workspace setup status',
      description:
        'Start here. Returns whether this workspace has a connected database, its data sources, and what to do next. Call this first in a fresh session.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async (_args, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const admin = requireAdminClient()
        const [{ data: org }, { data: sources }, { data: dashboards }] = await Promise.all([
          admin.from('organizations').select('id, name').eq('id', ctx.orgId).limit(1),
          admin
            .from('data_sources')
            .select('id, name, engine, status, last_connected_at')
            .eq('org_id', ctx.orgId)
            .is('deleted_at', null),
          admin.from('dashboards').select('id').eq('org_id', ctx.orgId).is('deleted_at', null),
        ])
        const ds = (sources ?? []) as Record<string, unknown>[]
        const hasFirestore = ds.some((d) => (d as { engine?: string }).engine === 'firestore')
        const hasSql = ds.some((d) => (d as { engine?: string }).engine !== 'firestore')
        return ok({
          connected: ds.length > 0,
          org: org?.[0] ?? { id: ctx.orgId },
          dataSources: ds,
          dashboardCount: dashboards?.length ?? 0,
          hints: ds.length
            ? [
                hasSql
                  ? 'SQL sources: get_schema to learn tables, execute_sql (SELECT-only) to query, then create_dashboard to persist KPIs the team can see.'
                  : null,
                hasFirestore
                  ? 'Firestore sources: use `ask` for natural-language analysis — the SQL tools (execute_sql/get_schema) do not apply to document databases.'
                  : null,
              ].filter(Boolean)
            : [`No data source connected. Open ${APP_URL}/app/sources to connect your database.`],
        })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'list_data_sources',
    {
      title: 'List data sources',
      description: 'List the databases connected to this workspace (id, name, engine, status).',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async (_args, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const { data } = await requireAdminClient()
          .from('data_sources')
          .select('id, name, engine, status, last_connected_at')
          .eq('org_id', ctx.orgId)
          .is('deleted_at', null)
        return ok({ dataSources: data ?? [] })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  // ── read ────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_schema',
    {
      title: 'Get database schema',
      description:
        'List the tables and columns of a connected database (read-only introspection). Use this before writing SQL so queries match the REAL production schema.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        dataSourceId: z.string().optional().describe('omit if the workspace has exactly one data source'),
        schema: z.string().optional().describe('optional schema name filter, e.g. "public"'),
      },
    },
    async ({ dataSourceId, schema }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const dsId = await resolveSqlDataSourceId(ctx.orgId, dataSourceId)
        const tables = await getSchema(dsId, schema)
        const rlsNote = rlsSchemaNote(tables).trim() || undefined
        return ok({ dataSourceId: dsId, tables, rlsNote })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'execute_sql',
    {
      title: 'Run read-only SQL',
      description:
        "Run a READ-ONLY (SELECT/WITH) SQL query against the workspace's connected PostgreSQL/MySQL database. Returns {columns, rows, rowCount, truncated}. Writes are structurally rejected (SELECT-only guard + read-only transaction). Credentials never leave supalens.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        sql: z.string().describe('a single read-only SELECT or WITH query'),
        dataSourceId: z.string().optional().describe('omit if the workspace has exactly one data source'),
      },
    },
    async ({ sql, dataSourceId }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const dsId = await resolveSqlDataSourceId(ctx.orgId, dataSourceId)
        const r = await executeReadOnly(dsId, sql, { actor: actorOf(ctx), maxRows: 1000, timeoutMs: 30_000 })
        return ok({ dataSourceId: dsId, columns: r.columns, rows: r.rows, rowCount: r.rowCount, truncated: r.truncated })
      } catch (e) {
        return err(`Query rejected or failed: ${String(e instanceof Error ? e.message : e).slice(0, 400)}`)
      }
    }
  )

  // ── read (Firestore / document sources) ───────────────────────────────────
  server.registerTool(
    'list_collections',
    {
      title: 'List Firestore collections',
      description:
        'List the top-level collection ids of a connected Firestore (document) data source. Use before query_documents. For SQL sources use get_schema instead.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { dataSourceId: z.string().optional().describe('omit if the workspace has exactly one data source') },
    },
    async ({ dataSourceId }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const dsId = await resolveFirestoreDataSourceId(ctx.orgId, dataSourceId)
        const { listCollections } = await import('@/lib/firestore')
        return ok({ dataSourceId: dsId, collections: await listCollections(dsId) })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'get_collection_schema',
    {
      title: 'Infer Firestore collection schema',
      description:
        "Infer a Firestore collection's fields and types by SAMPLING documents. Returns {collection, sampled, fields}. This is a sample, not authoritative — fields only in unsampled docs may be missing.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { collection: z.string().describe('collection id, e.g. "users"'), dataSourceId: z.string().optional() },
    },
    async ({ collection, dataSourceId }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const dsId = await resolveFirestoreDataSourceId(ctx.orgId, dataSourceId)
        const { inferCollectionSchema } = await import('@/lib/firestore')
        return ok({ dataSourceId: dsId, schema: await inferCollectionSchema(dsId, collection) })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'query_documents',
    {
      title: 'Query Firestore documents',
      description:
        "Read documents from ONE collection of the workspace's connected Firestore database, with optional where filters, an orderBy, and a limit. Returns {columns, rows, rowCount, truncated} (documents flattened; __id is the doc id). NO JOINs; results are capped.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        collection: z.string(),
        where: z.array(FirestoreWhere).optional(),
        orderBy: z.object({ field: z.string(), direction: z.enum(['asc', 'desc']).optional() }).optional(),
        limit: z.number().int().positive().max(1000).optional(),
        collectionGroup: z.boolean().optional().describe('query across all sub-collections with this id'),
        dataSourceId: z.string().optional(),
      },
    },
    async ({ collection, where, orderBy, limit, collectionGroup, dataSourceId }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const dsId = await resolveFirestoreDataSourceId(ctx.orgId, dataSourceId)
        const { queryDocuments } = await import('@/lib/firestore')
        const r = await queryDocuments(
          dsId,
          { collection, where, orderBy, limit, collectionGroup },
          { actor: actorOf(ctx), maxRows: 1000 }
        )
        return ok({ dataSourceId: dsId, columns: r.columns, rows: r.rows, rowCount: r.rowCount, truncated: r.truncated })
      } catch (e) {
        return err(`Query rejected or failed: ${String(e instanceof Error ? e.message : e).slice(0, 400)}`)
      }
    }
  )

  server.registerTool(
    'aggregate',
    {
      title: 'Aggregate Firestore documents',
      description:
        'Server-side aggregation over a Firestore collection: count, or sum/average of a numeric field, with optional where filters. Cheap — prefer over reading all documents to total them.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        collection: z.string(),
        op: z.enum(['count', 'sum', 'average']),
        field: z.string().optional().describe('required for sum/average'),
        where: z.array(FirestoreWhere).optional(),
        collectionGroup: z.boolean().optional(),
        dataSourceId: z.string().optional(),
      },
    },
    async ({ collection, op, field, where, collectionGroup, dataSourceId }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const dsId = await resolveFirestoreDataSourceId(ctx.orgId, dataSourceId)
        const { aggregateDocuments } = await import('@/lib/firestore')
        const r = await aggregateDocuments(dsId, { collection, op, field, where, collectionGroup }, { actor: actorOf(ctx) })
        return ok({ dataSourceId: dsId, columns: r.columns, rows: r.rows })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  // ── persist / productize ──────────────────────────────────────────────────
  server.registerTool(
    'register_query',
    {
      title: 'Save a reusable query',
      description:
        'Save a named, re-runnable SQL query to this workspace so it can back widgets and be reused by the team.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        name: z.string().describe('human-readable name, e.g. "Daily signups"'),
        sql: z.string().describe('a read-only SELECT/WITH query'),
        dataSourceId: z.string().optional(),
        source: z
          .string()
          .optional()
          .describe('provenance: where this came from, e.g. "src/lib/billing/mrr.ts" or a git ref'),
      },
    },
    async ({ name, sql, dataSourceId, source }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        assertMcpWriteAllowed(ctx) // member+ AND write scope — MCP is not an RLS bypass
        const dsId = await resolveSqlDataSourceId(ctx.orgId, dataSourceId)
        try {
          assertReadOnly(sql)
        } catch (e) {
          return err(`SQL is not read-only: ${String(e instanceof Error ? e.message : e)}`)
        }
        const { data, error } = await requireAdminClient()
          .from('saved_queries')
          .insert({ org_id: ctx.orgId, data_source_id: dsId, name, sql, created_by: ctx.createdBy, source: provenance(source) })
          .select('id')
          .limit(1)
        if (error || !data?.[0]) return err(`failed to save query: ${error?.message ?? 'unknown'}`)
        return ok({ savedQueryId: (data[0] as { id: string }).id, name })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'create_dashboard',
    {
      title: 'Create or update dashboard',
      // destructiveHint: re-running with an existing slug REPLACES that dashboard's widget set.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description:
        'Create (or update, by slug) a dashboard, optionally with widgets in one call. Each widget = a read-only SQL + a chart config; supalens runs the SQL, validates the chart against the real columns, and persists it. Re-running with the same slug REPLACES the widget set (declarative sync) — safe to re-run as code evolves. This is how you turn KPIs you found in a repo into a shared, live dashboard. For the automated path, extract_kpis proposes a full validated KPI catalog from the schema (and repo) and apply_kpis builds this dashboard from it.',
      inputSchema: {
        title: z.string().describe('dashboard title'),
        slug: z.string().optional().describe('stable id for idempotent updates; defaults to a slug of the title'),
        dataSourceId: z.string().optional(),
        widgets: z
          .array(
            z.object({
              sql: z.string().describe('read-only SELECT/WITH that produces the widget data'),
              chart: ChartSpec.describe('chart config; encodings reference result columns BY NAME'),
              source: z.string().optional().describe('provenance: repo path / git ref this KPI was derived from'),
            })
          )
          .max(MAX_WIDGETS)
          .optional(),
      },
    },
    async ({ title, slug, dataSourceId, widgets }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        assertMcpWriteAllowed(ctx) // member+ AND write scope — MCP is not an RLS bypass
        const admin = requireAdminClient()
        const theSlug = slug ? slugify(slug) : slugify(title)
        const list = widgets ?? []

        // Plan cap — this call REPLACES the whole widget set, so enforce the FINAL count against
        // widgets_per_dashboard (row-count enforceResourceLimit only checks "one more", which
        // doesn't fit a batch replace). MCP must not be a cap bypass (same rule as create_alert).
        if (list.length) {
          const widgetCap = await planLimitFor(ctx.orgId, 'widgets_per_dashboard')
          if (widgetCap != null && list.length > widgetCap) {
            return err(`widget limit exceeded (${widgetCap} per dashboard) — reduce the widget count or upgrade the plan`)
          }
        }

        // Phase 1 — validate EVERY widget before touching the DB (no partial writes).
        let dsId: string | null = null
        const built: { sql: string; spec: z.infer<typeof VisualizationSpec>; sample: unknown; source?: string }[] = []
        if (list.length) {
          dsId = await resolveSqlDataSourceId(ctx.orgId, dataSourceId)
          for (let i = 0; i < list.length; i++) {
            try {
              const b = await buildWidgetSpec(dsId, actorOf(ctx), list[i].sql, list[i].chart)
              built.push({ sql: list[i].sql, spec: b.spec, sample: b.sample, source: list[i].source })
            } catch (e) {
              return err(`widget #${i + 1} rejected: ${String(e instanceof Error ? e.message : e)}`)
            }
          }
        }

        // Phase 2 — upsert dashboard by (org, slug); declarative widget sync.
        const { data: existing } = await admin
          .from('dashboards')
          .select('id')
          .eq('org_id', ctx.orgId)
          .eq('slug', theSlug)
          .is('deleted_at', null)
          .limit(1)

        let dashboardId: string
        if (existing?.[0]) {
          dashboardId = (existing[0] as { id: string }).id
          await admin.from('dashboards').update({ name: title }).eq('id', dashboardId)
          // declarative sync retires the previous widget set — SOFT delete (repo convention);
          // a hard .delete() bypassed deleted_at and destroyed the recovery trail.
          if (list.length) {
            await admin
              .from('dashboard_widgets')
              .update({ deleted_at: new Date().toISOString() })
              .eq('dashboard_id', dashboardId)
              .is('deleted_at', null)
          }
        } else {
          // NEW dashboard → enforce the per-plan dashboards cap (MCP is not a cap bypass).
          const cap = await enforceResourceLimit(ctx.orgId, 'dashboards', {
            table: 'dashboards',
            label: 'dashboard',
            softDelete: true,
            filters: [{ column: 'org_id', value: ctx.orgId }],
          })
          if (!cap.ok) return err(cap.error)
          const { data, error } = await admin
            .from('dashboards')
            .insert({ org_id: ctx.orgId, slug: theSlug, name: title, created_by: ctx.createdBy })
            .select('id')
            .limit(1)
          if (error || !data?.[0]) return err(`failed to create dashboard: ${error?.message ?? 'unknown'}`)
          dashboardId = (data[0] as { id: string }).id
        }

        for (let i = 0; i < built.length; i++) {
          const w = built[i]
          const { data: sq } = await admin
            .from('saved_queries')
            .insert({ org_id: ctx.orgId, data_source_id: dsId, name: w.spec.chart.title ?? title, sql: w.sql, created_by: ctx.createdBy, source: provenance(w.source) })
            .select('id')
            .limit(1)
          await admin.from('dashboard_widgets').insert({
            dashboard_id: dashboardId,
            org_id: ctx.orgId,
            saved_query_id: (sq?.[0] as { id: string } | undefined)?.id ?? null,
            data_source_id: dsId,
            spec: withoutSample(w.spec), // snapshot lives once, in the sample column
            sample: w.sample,
            position: i,
          })
        }

        return ok({
          dashboardId,
          slug: theSlug,
          widgetCount: built.length,
          url: `${APP_URL}/app/dashboards`,
        })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'add_widget',
    {
      title: 'Add dashboard widget',
      description:
        'Add ONE chart widget to an existing dashboard. supalens runs the SQL read-only, validates the chart against the real columns, and persists it.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        dashboard: z.string().describe('dashboard id or slug'),
        sql: z.string().describe('read-only SELECT/WITH for the widget data'),
        chart: ChartSpec,
        dataSourceId: z.string().optional(),
        source: z.string().optional().describe('provenance: repo path / git ref this KPI was derived from'),
      },
    },
    async ({ dashboard, sql, chart, dataSourceId, source }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        assertMcpWriteAllowed(ctx) // member+ AND write scope — MCP is not an RLS bypass
        const admin = requireAdminClient()
        const dashboardId = await findDashboardId(ctx.orgId, dashboard)
        if (!dashboardId) return err(`dashboard "${dashboard}" not found in your workspace`)

        // Plan cap — one more widget on this dashboard (MCP is not a cap bypass; mirrors the web
        // addWidgetToDashboard path).
        const cap = await enforceResourceLimit(ctx.orgId, 'widgets_per_dashboard', {
          table: 'dashboard_widgets',
          label: 'widget',
          softDelete: true,
          filters: [{ column: 'dashboard_id', value: dashboardId }],
        })
        if (!cap.ok) return err(cap.error)

        const dsId = await resolveSqlDataSourceId(ctx.orgId, dataSourceId)
        let b
        try {
          b = await buildWidgetSpec(dsId, actorOf(ctx), sql, chart)
        } catch (e) {
          return err(String(e instanceof Error ? e.message : e))
        }
        const { data: sq } = await admin
          .from('saved_queries')
          .insert({ org_id: ctx.orgId, data_source_id: dsId, name: b.spec.chart.title ?? 'widget', sql, created_by: ctx.createdBy, source: provenance(source) })
          .select('id')
          .limit(1)
        const { data: widget, error } = await admin
          .from('dashboard_widgets')
          .insert({
            dashboard_id: dashboardId,
            org_id: ctx.orgId,
            saved_query_id: (sq?.[0] as { id: string } | undefined)?.id ?? null,
            data_source_id: dsId,
            spec: withoutSample(b.spec), // snapshot lives once, in the sample column
            sample: b.sample,
            x: 0,
            y: 0,
            ...defaultGridSize(b.spec.chart),
          })
          .select('id')
          .limit(1)
        if (error || !widget?.[0]) return err(`failed to add widget: ${error?.message ?? 'unknown'}`)
        return ok({ widgetId: (widget[0] as { id: string }).id, dashboardId })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'list_dashboards',
    {
      title: 'List dashboards',
      description: 'List dashboards in this workspace (id, slug, name, pinned).',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async (_args, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const { data } = await requireAdminClient()
          .from('dashboards')
          .select('id, slug, name, pinned, updated_at')
          .eq('org_id', ctx.orgId)
          .is('deleted_at', null)
          .order('position', { ascending: true })
        return ok({ dashboards: data ?? [] })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'list_widgets',
    {
      title: 'List dashboard widgets',
      description: 'List the widgets on a dashboard (id, title, chart type).',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { dashboard: z.string().describe('dashboard id or slug') },
    },
    async ({ dashboard }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const admin = requireAdminClient()
        const dashboardId = await findDashboardId(ctx.orgId, dashboard)
        if (!dashboardId) return err(`dashboard "${dashboard}" not found`)
        const { data } = await admin
          .from('dashboard_widgets')
          .select('id, spec, position')
          .eq('dashboard_id', dashboardId)
          .is('deleted_at', null) // soft-deleted widgets must not resurface (admin client bypasses RLS)
          .order('position', { ascending: true })
        const widgets = (data ?? []).map((w: Record<string, unknown>) => {
          const chart = (w.spec as { chart?: { title?: string; type?: string } } | null)?.chart
          return { id: String(w.id), title: chart?.title ?? null, type: chart?.type ?? null }
        })
        return ok({ widgets })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  // ── delegate heavy reasoning to the supalens analysis agent ───────────────
  server.registerTool(
    'ask',
    {
      title: 'Ask the analysis agent',
      description:
        'Delegate a natural-language analytics question to the supalens analysis agent (multi-step NL→SQL→chart) instead of doing it inline. Returns a runId; poll get_analysis with it. Use this for open-ended questions where the answer is in the DATA rather than the repo code.',
      // readOnlyHint despite the run-record insert: the analysis itself is strictly read-only
      // over the tenant DB and no workspace resource is mutated — the run row + metered-quota
      // increment are internal bookkeeping, same as an audit log.
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        question: z.string().max(4000).describe('the analytics question, in natural language'),
        dataSourceId: z.string().optional(),
      },
    },
    async ({ question, dataSourceId }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const dsId = await resolveDataSourceId(ctx.orgId, dataSourceId)
        // Metered quota gate (billing / cost-abuse guard) — mirrors the web BFF.
        const quota = await checkUsageQuota(ctx.orgId)
        if (!quota.allowed) return err(quota.reason ?? 'usage limit exceeded — upgrade the plan')
        const admin = requireAdminClient()
        // route Firestore (document) sources to their own task; SQL sources to `analyze`.
        const { data: dsRow } = await admin.from('data_sources').select('engine').eq('id', dsId).limit(1)
        const taskId = taskIdForEngine((dsRow?.[0] as { engine?: string } | undefined)?.engine)
        const locale = await resolveUserLocale(ctx.createdBy)

        // shared run-creation core (same as the web BFF / Slack): dedupe window → insert → trigger
        const created = await createAgentRun({
          orgId: ctx.orgId,
          dataSourceId: dsId,
          userId: ctx.createdBy,
          question,
          channel: 'mcp',
          taskId,
          payloadExtra: { locale },
        })
        switch (created.status) {
          case 'created':
            return ok({ runId: created.runId, status: 'queued', poll: 'call get_analysis with this runId until done=true' })
          case 'duplicate':
            return ok({
              runId: created.runId,
              status: 'queued',
              note: 'an identical question is already queued/running for this data source — returning that run instead of starting a duplicate.',
              poll: 'call get_analysis with this runId until done=true',
            })
          case 'no_worker':
            return ok({
              runId: created.runId,
              status: 'queued',
              note: 'queued, but the analysis worker (Trigger.dev) is not configured in this environment — the run will not progress here.',
            })
          case 'insert_failed':
            return err('failed to queue analysis')
          case 'trigger_failed':
            return err('failed to start analysis (the worker rejected the run)')
        }
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'get_analysis',
    {
      title: 'Get analysis result',
      description: 'Poll the result of an ask() run. Returns {status, done, result, error}. result holds the agent prose + any visualizations once done.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { runId: z.string().describe('the runId returned by ask') },
    },
    async ({ runId }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const { data } = await requireAdminClient()
          .from('agent_runs')
          .select('id, status, result, error, turns, ended_at')
          .eq('id', runId)
          .eq('org_id', ctx.orgId)
          .limit(1)
        const row = data?.[0] as
          | { status: string; result: unknown; error: string | null; turns: number; ended_at: string | null }
          | undefined
        if (!row) return err(`analysis run "${runId}" not found in your workspace`)
        return ok({
          runId,
          status: row.status,
          done: row.ended_at != null,
          turns: row.turns,
          result: row.result ?? null,
          error: row.error ?? null,
        })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  // ── alerts ────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_alerts',
    {
      title: 'List alerts',
      description:
        "List this workspace's alerts (monitors that notify the team — email, Slack, Discord — when a metric query crosses a threshold).",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async (_args, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const { data } = await requireAdminClient()
          .from('alerts')
          .select('id, name, type, metric_sql, operator, threshold, enabled, status, last_value, last_checked_at, data_source_id')
          .eq('org_id', ctx.orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
        // goal monitors' words + rule, read on their own so a pre-migration DB still lists alerts
        const goals = new Map<string, { goal: string | null; condition: unknown }>()
        const ids = ((data ?? []) as { id: string }[]).map((a) => a.id)
        if (ids.length) {
          const { data: g } = await requireAdminClient().from('alerts').select('id, goal, condition').in('id', ids)
          for (const r of (g ?? []) as { id: string; goal: string | null; condition: unknown }[]) goals.set(r.id, { goal: r.goal, condition: r.condition })
        }
        return ok({ alerts: ((data ?? []) as { id: string }[]).map((a) => ({ ...a, ...(goals.get(a.id) ?? {}) })) })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'create_alert',
    {
      title: 'Create alert',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Create an alert. PREFER A GOAL MONITOR: pass `goal` (the user\'s own words, e.g. "tell me when signups dip") plus a structured `condition`, and a metricSql that returns a DAILY series — one row per day, oldest→newest, the day first and the measure last, days with no activity as 0 (build the day axis with generate_series and end it at current_date - 1). condition.strategy: "anomaly" (no number given — {direction: down|up|both, sensitivity σ default 3, window trailing days default 28}), "relative" (a comparison — {direction: down|up, pct as a FRACTION e.g. 0.3, window trailing days}), "absolute" (ONLY when the user gave the number — {operator, threshold}). Never invent an absolute number the user did not give. The response includes a backtest (how often the rule would have fired over the returned history) — tell the user. LEGACY (no condition): THRESHOLD (default): metricSql returns ONE numeric scalar; email when it satisfies operator vs threshold. ANOMALY (type="anomaly"): metricSql returns a TIME SERIES (rows ordered oldest→newest, the measure as the LAST column, e.g. `select day, sum(amount) v from ... group by day order by day`) and it fires when the latest point deviates from the learned baseline by >= sensitivity standard deviations (default 3) — NO threshold needed, good for "tell me when it looks weird". For a RELATIVE threshold ("below last week\'s average"), encode the comparison INTO metricSql (e.g. `select today_total - last_week_avg`) and compare to 0. Author metricSql with get_schema + execute_sql first so it matches the real schema. operator is one of lt/lte/gt/gte/eq/neq.',
      inputSchema: {
        name: z.string().min(1).describe('human label, e.g. "일매출 1천만원 미만"'),
        metricSql: z.string().min(1).describe('read-only SELECT: one numeric scalar (threshold) OR an ordered numeric series (anomaly)'),
        type: z.enum(['threshold', 'change_rate', 'anomaly']).optional().describe('default threshold; "anomaly" for threshold-less outlier detection'),
        operator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'neq']).optional().describe('required for threshold alerts; ignored for anomaly'),
        threshold: z.number().optional().describe('required for threshold alerts; ignored for anomaly'),
        sensitivity: z.number().optional().describe('anomaly only: z-score cutoff, default 3'),
        dataSourceId: z.string().optional().describe('omit if the workspace has exactly one data source'),
        description: z.string().optional(),
        goal: z.string().max(500).optional().describe("goal monitor: the user's own words — shown as the monitor's headline"),
        condition: MonitorCondition.optional().describe(
          'goal monitor rule (v: 1). anomaly {direction, sensitivity, window} | relative {direction, pct, window} | absolute {operator, threshold}. Requires a DAILY series metricSql.',
        ),
      },
    },
    async (args, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        assertMcpWriteAllowed(ctx) // member+ AND write scope — MCP is not an RLS bypass
        const a = args as {
          name: string; metricSql: string; type?: string; operator?: string; threshold?: number
          sensitivity?: number; dataSourceId?: string; description?: string; goal?: string; condition?: MonitorCondition
        }
        try {
          assertReadOnly(a.metricSql)
        } catch (e) {
          return err(`metricSql must be a single read-only SELECT: ${e instanceof Error ? e.message : e}`)
        }
        if (a.condition) return await createGoalAlert(ctx, a as typeof a & { condition: MonitorCondition })
        const type = a.type ?? 'threshold'
        const isAnomaly = type === 'anomaly'
        if (!isAnomaly && (!a.operator || a.threshold === undefined)) {
          return err('threshold alerts require both operator and threshold')
        }
        // anomaly leaves operator/threshold as unused placeholders (the runner ignores them)
        const operator = isAnomaly ? 'gt' : a.operator
        const threshold = isAnomaly ? 0 : a.threshold
        const sensitivity = isAnomaly ? (a.sensitivity ?? 3) : null
        // alerts run metric_sql through the SQL engine — a document source must be rejected here,
        // not evaluated (and failed) forever by the */5 cron
        const dsId = await resolveSqlDataSourceId(ctx.orgId, a.dataSourceId)
        // plan cap — mirrors the web createAlert action (MCP must not be a cap bypass)
        const cap = await enforceResourceLimit(ctx.orgId, 'alerts_per_org', {
          table: 'alerts',
          label: 'alert',
          softDelete: true,
          filters: [{ column: 'org_id', value: ctx.orgId }],
        })
        if (!cap.ok) return err(cap.error)
        const { data, error } = await requireAdminClient()
          .from('alerts')
          .insert({ org_id: ctx.orgId, data_source_id: dsId, name: a.name, description: a.description ?? null, type, metric_sql: a.metricSql, operator, threshold, sensitivity })
          .select('id')
          .limit(1)
        if (error) return err(error.message)
        return ok({ id: (data?.[0] as { id: string } | undefined)?.id, created: true, type })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'toggle_alert',
    {
      title: 'Enable or disable alert',
      description: 'Enable or disable an alert by id.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { alertId: z.string(), enabled: z.boolean() },
    },
    async (args, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        assertMcpWriteAllowed(ctx) // member+ AND write scope — MCP is not an RLS bypass
        const { alertId, enabled } = args as { alertId: string; enabled: boolean }
        const { data, error } = await requireAdminClient()
          .from('alerts')
          .update({ enabled })
          .eq('id', alertId)
          .eq('org_id', ctx.orgId)
          .is('deleted_at', null)
          .select('id')
        if (error) return err(error.message)
        if (!data?.length) return err(`alert "${alertId}" not found in your workspace`)
        return ok({ id: alertId, enabled })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'delete_alert',
    {
      title: 'Delete alert',
      description: 'Delete an alert by id (soft delete).',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: { alertId: z.string() },
    },
    async (args, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        assertMcpWriteAllowed(ctx) // member+ AND write scope — MCP is not an RLS bypass
        const { alertId } = args as { alertId: string }
        const { data, error } = await requireAdminClient()
          .from('alerts')
          .update({ deleted_at: new Date().toISOString(), enabled: false })
          .eq('id', alertId)
          .eq('org_id', ctx.orgId)
          .is('deleted_at', null)
          .select('id')
        if (error) return err(error.message)
        if (!data?.length) return err(`alert "${alertId}" not found in your workspace`)
        return ok({ id: alertId, deleted: true })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  // ── auto-KPI (repo/schema-driven catalog: extract → review → one-shot apply) ───────────────
  server.registerTool(
    'extract_kpis',
    {
      title: 'Extract KPI catalog',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Kick off an AI KPI extraction for a connected SQL data source: the agent reads the schema (and, when a repo is attached, the code) and proposes a validated, runnable KPI catalog — each KPI is title + SQL + chart + optional alert + code/table evidence, and every SQL is executed before it is proposed. Runs on the Trigger.dev host and returns immediately with an extractionId; poll list_kpis until proposals appear, then apply_kpis to build the dashboard. Metered — counts toward your plan quota. (The demo source ships a built-in catalog instead; call list_kpis on it directly.)',
      inputSchema: {
        dataSourceId: z.string().optional().describe('omit if the workspace has exactly one data source'),
      },
    },
    async ({ dataSourceId }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        assertMcpWriteAllowed(ctx) // member+ AND write scope — MCP is not an RLS bypass
        const dsId = await resolveSqlDataSourceId(ctx.orgId, dataSourceId)
        const admin = requireAdminClient()

        // repo_id + is_demo — the same columns the extract BFF route reads (added after the last db:types run).
        const { data: dsFull } = await admin.from('data_sources').select('repo_id, is_demo').eq('id', dsId).limit(1)
        const dsRow = dsFull?.[0] as { repo_id: string | null; is_demo: boolean | null } | undefined

        // Demo sources ship a canned catalog — never pay for an LLM extraction on them.
        if (dsRow?.is_demo) {
          return err('The demo data source ships a built-in KPI catalog; extraction is not run for it. Call list_kpis to see it.')
        }

        // Don't stack extractions: a 'running' run younger than the TTL blocks a fresh trigger.
        const latest = await latestExtraction(dsId)
        if (latest && latest.status === 'running') {
          if (Date.now() - new Date(latest.createdAt).getTime() < EXTRACTION_RUNNING_TTL_MS) {
            return err('extraction already in progress')
          }
          // stale 'running' → fail it so the one-running-per-source unique index frees its slot
          await failExtraction(latest.id, 'timed out (no completion signal)')
        }

        // Metered quota gate (billing / cost-abuse guard) — mirrors the extract BFF + the `ask` tool.
        const quota = await checkUsageQuota(ctx.orgId)
        if (!quota.allowed) return err(quota.reason ?? 'usage limit exceeded — upgrade the plan')

        // Tier: repo attached -> tier 2 (resolve repo + installation, assert same org); else tier 1.
        const repoId = dsRow?.repo_id ?? null
        let tier: 1 | 2 = 1
        let repo: { id: string; full_name: string; default_branch: string; sparse_paths: string[] | null } | undefined
        let installationId: number | undefined
        if (repoId) {
          const { data: repoRows } = await admin
            .from('github_repositories')
            .select('id, org_id, connection_id, full_name, default_branch, sparse_paths')
            .eq('id', repoId)
            .is('deleted_at', null)
            .limit(1)
          const r = repoRows?.[0] as
            | { id: string; org_id: string; connection_id: string; full_name: string; default_branch: string; sparse_paths: string[] | null }
            | undefined
          if (!r || r.org_id !== ctx.orgId) return err('the repository attached to this data source is not valid for your workspace')
          const { data: connRows } = await admin
            .from('provider_connections')
            .select('installation_id')
            .eq('id', r.connection_id)
            .limit(1)
          const instId = (connRows?.[0] as { installation_id: number | null } | undefined)?.installation_id
          if (instId == null) return err('the GitHub installation for the attached repository was not found')
          tier = 2
          repo = { id: r.id, full_name: r.full_name, default_branch: r.default_branch, sparse_paths: r.sparse_paths }
          installationId = instId
        }

        // Both tiers run on the Trigger host (the agent needs a subprocess) — mirror `ask`'s guard.
        if (!process.env.TRIGGER_SECRET_KEY) {
          return err('KPI extraction requires the Trigger.dev worker, which is not configured in this environment.')
        }

        let extractionId: string
        try {
          ;({ id: extractionId } = await createExtraction({
            orgId: ctx.orgId,
            dataSourceId: dsId,
            tier,
            createdBy: ctx.createdBy ?? undefined,
          }))
        } catch (e) {
          if (e instanceof Error && e.message === EXTRACTION_ALREADY_RUNNING) return err('extraction already in progress')
          throw e
        }
        const payload: ExtractKpisPayload = {
          orgId: ctx.orgId,
          dataSourceId: dsId,
          extractionId,
          tier,
          // omit when the token has no recorded creator (trigger falls back to 'system')
          userId: ctx.createdBy ?? undefined,
          ...(tier === 2 && repo
            ? { repoId: repo.id, installationId, fullName: repo.full_name, ref: repo.default_branch, sparsePaths: repo.sparse_paths ?? undefined }
            : {}),
        }
        try {
          const { tasks } = await import('@trigger.dev/sdk')
          const handle = await tasks.trigger('extract-kpis', payload, { concurrencyKey: dsId })
          await setExtractionTriggerRunId(extractionId, handle.id)
        } catch (e) {
          await failExtraction(extractionId, persistableError(e, String(e).slice(0, 200)))
          return err(`failed to start extraction: ${String(e instanceof Error ? e.message : e)}`)
        }
        return ok({
          extractionId,
          tier,
          status: 'running',
          next: `KPI extraction started (tier ${tier}). Poll list_kpis until proposals appear, then apply_kpis to build the core-KPI dashboard.`,
        })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'list_kpis',
    {
      title: 'List KPI catalog',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        "List the extracted KPI catalog for a connected SQL data source: the proposals from extract_kpis (or the demo source's built-in catalog). Returns the latest extraction status and the KPI rows (title, category, importance, SQL, chart, alert, evidence, status). Poll this after extract_kpis until proposals appear, then pass the ids you want to apply_kpis. (Preview sample rows are trimmed here; the full sample is kept in supalens.)",
      inputSchema: {
        dataSourceId: z.string().optional().describe('omit if the workspace has exactly one data source'),
        status: z
          .enum(['proposed', 'accepted', 'dismissed', 'stale'])
          .optional()
          .describe('filter to one status; omit for all'),
      },
    },
    async ({ dataSourceId, status }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        const dsId = await resolveSqlDataSourceId(ctx.orgId, dataSourceId)
        const [kpis, extraction] = await Promise.all([listKpis(dsId), latestExtraction(dsId)])
        const filtered = status ? kpis.filter((k) => k.status === status) : kpis
        return ok({ dataSourceId: dsId, extraction, kpis: filtered.map(trimKpiSample) })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )

  server.registerTool(
    'apply_kpis',
    {
      title: 'Apply KPIs to dashboard',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description:
        'Turn a set of proposed KPIs into live artifacts in one call: a "핵심 KPI" dashboard (or a chosen existing one), a widget per KPI, and — when withAlerts — an alert per KPI that carries an alert config. Each KPI is re-validated (SQL runs read-only + chart columns checked) before anything is written; per-item failures are reported without undoing the KPIs that succeed. Get the ids from list_kpis first.',
      inputSchema: {
        kpiIds: z.array(z.string()).min(1).max(40).describe('catalog ids (from list_kpis) to apply'),
        dataSourceId: z.string().optional().describe('omit if the workspace has exactly one data source'),
        dashboardId: z.string().optional().describe('an existing dashboard id to add to; omit for the idempotent "핵심 KPI" dashboard'),
        withAlerts: z.boolean().optional().describe('also create alerts for KPIs that carry an alert config (default true)'),
      },
    },
    async ({ kpiIds, dataSourceId, dashboardId, withAlerts }, extra: Extra) => {
      try {
        const ctx = ctxOf(extra)
        assertMcpWriteAllowed(ctx) // member+ AND write scope — MCP is not an RLS bypass
        const dsId = await resolveSqlDataSourceId(ctx.orgId, dataSourceId)
        const result = await applyKpis({
          orgId: ctx.orgId,
          // Mirror create_dashboard's created_by: the acting user (ctx.createdBy). The profiles-FK
          // created_by columns and the audit actor_id are all nullable, so a null-creator token
          // flows through safely as NULL — the cast only satisfies applyKpis's non-null `string`.
          userId: ctx.createdBy as string,
          dataSourceId: dsId,
          kpiIds,
          dashboardId,
          withAlerts: withAlerts ?? true,
          locale: await resolveUserLocale(ctx.createdBy),
        })
        // "N applied" is NOT "N monitored" — only KPIs carrying an alert config get a monitor,
        // so the summary reports both numbers (and the cap, when one truncated the run).
        const monitors = result.plan.monitorsToCreate
        const dashboardOnly = result.applied - monitors
        const capped = result.plan.capBlocked.length
        const summary =
          `${result.applied} applied · ${monitors} monitored, ${dashboardOnly} dashboard-only` +
          `${result.failed ? `, ${result.failed} failed` : ''}` +
          `${capped ? ` · ${capped} skipped by plan caps` : ''}` +
          ` · dashboard "${result.dashboardSlug}" (${APP_URL}/app/dashboards)`
        return ok({ ...result, summary })
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
  )
}
