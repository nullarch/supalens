import { createSdkMcpServer, tool } from '@/lib/llm/agent-sdk'
import { z } from 'zod'

import { executeReadOnly, getSchema, rlsSchemaNote } from '@/lib/query'
import { ProposeKpiInput, type KpiSink } from '@/lib/kpi/types'
import { validateKpiProposal } from '@/lib/kpi/propose'
import type { Actor } from '@/lib/secrets/service'
import { ProposeVizInput } from '@/lib/viz/spec'
import type { VisualizationSpec as VizSpec, FirestoreQueryRef } from '@/lib/viz/spec'
import { MAX_CHARTS_PER_RUN, validateVizProposal } from '@/lib/viz/propose'
import { ProposeMonitorInput, validateMonitorProposal, type MonitorDraftSink } from '@/lib/alerts/draft'

/** Sink the host passes in to collect query results + accepted visualizations. `firestore` is
 *  the structured re-run descriptor, set only by the Firestore document tools. */
export interface VizSink {
  onVisualization: (spec: VizSpec) => void
  onQueryResult?: (q: {
    queryId: string
    sql: string
    columns: string[]
    rows: Record<string, unknown>[]
    firestore?: FirestoreQueryRef
  }) => void
}

/**
 * In-process MCP tools for the analysis agent. The handlers run in THIS (parent) Node
 * process — the decrypted credentials + pg pool live in `executeReadOnly`'s closure and
 * never enter the model context or the SDK subprocess. The agent only ever sees the JSON
 * the handler returns.
 *
 * `dataSourceId` is bound here from the trusted task payload; the model cannot choose a
 * different data source (and `canUseTool` re-checks the tool name on every call).
 *
 * `propose_visualization` is a pure in-process handler: it reads only the in-memory
 * result `store`, issues no SQL, opens no pool, and touches no vault/KMS — so it adds NO
 * new capability to the locked-down subprocess. It is the seam where the agent CHOOSES a
 * chart for a prior query result.
 *
 * `propose_kpi` (registered only when a `KpiSink` is supplied, for KPI-extraction runs) is
 * the same kind of pure in-process handler over the same `store` — it validates a KPI
 * proposal and hands it to the sink, adding no DB/vault/KMS access of its own.
 *
 * `propose_monitor` (registered only when a `MonitorDraftSink` is supplied, for goal → monitor
 * drafting runs) is the same kind of handler: it validates the proposed rule against the stashed
 * daily series (pure goal-series check + backtest) and hands the draft to the sink. The monitor is
 * CREATED later, by the operator's approval through the normal member-gated action — never here.
 */
export function buildSqlTools(dataSourceId: string, actor: Actor, sink?: VizSink, kpiSink?: KpiSink, monitorSink?: MonitorDraftSink) {
  // queryId → result, so propose_visualization / propose_kpi can validate referenced columns and bind SQL.
  const store = new Map<string, { sql: string; columns: string[]; rows: Record<string, unknown>[] }>()
  // keys already proposed this run, so propose_kpi rejects duplicates within one extraction.
  const seenKeys = new Set<string>()
  // charts accepted this run — validateVizProposal rejects the (MAX_CHARTS_PER_RUN+1)th.
  let vizAccepted = 0
  let seq = 0

  // propose_kpi joins the tool set only for extraction runs (a KpiSink is passed); otherwise the
  // agent's tool surface is byte-for-byte unchanged. `kpiSinkRef` is a const capture so the
  // narrowing survives into the handler closure.
  const kpiSinkRef = kpiSink
  const kpiTools = kpiSinkRef
    ? [
        tool(
          'propose_kpi',
          'Register ONE validated KPI for the catalog. Run execute_sql FIRST and pass the queryId it returned — that binds the KPI to SQL that actually ran. If you attach an alert, the SQL must return a single numeric scalar (1 row × 1 column) so the alert runner can evaluate it. Every KPI needs at least one evidence item (the file / table / event that justifies it).',
          ProposeKpiInput,
          async (input) => {
            const res = validateKpiProposal(store, seenKeys, input)
            if (!res.ok) {
              return { content: [{ type: 'text' as const, text: res.error }], isError: true }
            }
            await kpiSinkRef.onKpi(res.proposal)
            seenKeys.add(res.proposal.key)
            return { content: [{ type: 'text' as const, text: `KPI "${res.proposal.key}" accepted: ${res.proposal.title}` }] }
          }
        ),
      ]
    : []

  const monitorSinkRef = monitorSink
  const monitorTools = monitorSinkRef
    ? [
        tool(
          'propose_monitor',
          'Register the monitor draft for the user\'s goal. Run execute_sql FIRST with a DAILY series (day first, measure last, oldest→newest, zero days included, ending yesterday) and pass the queryId it returned plus the structured condition. Replies with a backtest of the rule over that history.',
          ProposeMonitorInput,
          async (input) => {
            const res = validateMonitorProposal(store, monitorSinkRef, input, Date.now())
            if (!res.ok) {
              return { content: [{ type: 'text' as const, text: res.error }], isError: true }
            }
            await monitorSinkRef.onDraft(res.draft)
            return { content: [{ type: 'text' as const, text: res.summary }] }
          }
        ),
      ]
    : []

  return createSdkMcpServer({
    name: 'supalens',
    instructions: 'Read-only access to the connected database, plus chart proposals.',
    tools: [
      tool(
        'execute_sql',
        'Run a READ-ONLY SQL (SELECT/WITH) query against the connected database. Returns JSON {queryId, columns, rows, rowCount, truncated}. Pass the queryId to propose_visualization to chart the result.',
        { sql: z.string().describe('A single read-only SELECT or WITH query.') },
        async ({ sql }) => {
          try {
            const r = await executeReadOnly(dataSourceId, sql, { actor, maxRows: 1000, timeoutMs: 30_000 })
            const queryId = `q${++seq}`
            store.set(queryId, { sql, columns: r.columns, rows: r.rows })
            sink?.onQueryResult?.({ queryId, sql, columns: r.columns, rows: r.rows })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ queryId, columns: r.columns, rows: r.rows, rowCount: r.rowCount, truncated: r.truncated }),
                },
              ],
            }
          } catch (e) {
            return {
              content: [{ type: 'text' as const, text: `Query rejected or failed: ${String(e).slice(0, 300)}` }],
              isError: true,
            }
          }
        }
      ),
      tool(
        'get_schema',
        'List tables and columns of the connected database. Optionally filter by a schema name.',
        { schema: z.string().optional().describe('optional schema name to filter') },
        async ({ schema }) => {
          try {
            const s = await getSchema(dataSourceId, schema)
            return { content: [{ type: 'text' as const, text: rlsSchemaNote(s) + JSON.stringify(s) }] }
          } catch (e) {
            return {
              content: [{ type: 'text' as const, text: `Schema introspection failed: ${String(e).slice(0, 300)}` }],
              isError: true,
            }
          }
        }
      ),
      tool(
        'propose_visualization',
        `Choose and configure ONE chart for a prior query result. Pass the queryId returned by execute_sql and a chart config. Every column the chart references MUST exist in that query result. At most ${MAX_CHARTS_PER_RUN} charts are accepted per answer.`,
        ProposeVizInput,
        async ({ queryId, chart }) => {
          const res = validateVizProposal(store, vizAccepted, { queryId, chart })
          if (!res.ok) {
            return { content: [{ type: 'text' as const, text: res.error }], isError: true }
          }
          sink?.onVisualization(res.spec)
          vizAccepted++
          return { content: [{ type: 'text' as const, text: `Visualization (${chart.type}) accepted: ${chart.title}` }] }
        }
      ),
      ...kpiTools,
      ...monitorTools,
    ],
  })
}
