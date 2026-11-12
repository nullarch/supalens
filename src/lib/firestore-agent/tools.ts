// NOT `import 'server-only'` — runs in the Trigger.dev runtime. Sibling of agent/tools.ts with
// the INVERSE backend: Firestore document tools instead of SQL. The handlers run in THIS parent
// process — the Firestore client + decrypted service-account key live in the data-access layer's
// closure (src/lib/firestore/*) and never enter the model context or the SDK subprocess. The
// model only ever sees the JSON a handler returns.
//
// `propose_visualization` is the same seam as the SQL agent: a pure in-process handler that reads
// ONLY the in-memory result `store` (no Firestore access), so it adds no capability to the
// locked-down subprocess. Query/aggregate results are flattened to {columns, rows}, so the chart
// validation + VisualizationSpec are identical to the SQL path.
import { createSdkMcpServer, tool } from '@/lib/llm/agent-sdk'
import { z } from 'zod'

import type { VizSink } from '@/lib/agent/tools'
import { aggregateDocuments, describeQuery, inferCollectionSchema, listCollections, queryDocuments } from '@/lib/firestore'
import type { Actor } from '@/lib/secrets/service'
import { ProposeVizInput } from '@/lib/viz/spec'
import type { FirestoreQueryRef } from '@/lib/viz/spec'
import { MAX_CHARTS_PER_RUN, validateVizProposal } from '@/lib/viz/propose'

const WhereClauseSchema = z.object({
  field: z.string().describe('document field; dot notation for nested (e.g. "address.city")'),
  op: z.enum(['<', '<=', '==', '!=', '>=', '>', 'array-contains', 'in', 'not-in', 'array-contains-any']),
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()]))]),
})

/**
 * In-process MCP tools for the Firestore analysis agent. `dataSourceId` is bound from the trusted
 * task payload — the model cannot choose a different source (and canUseTool re-checks the tool
 * name). Mirrors buildSqlTools.
 */
export function buildFirestoreTools(dataSourceId: string, actor: Actor, sink?: VizSink) {
  // queryId → result, so propose_visualization can validate referenced columns and bind a
  // descriptor. `firestore` (set for query_documents) is the structured re-run descriptor a saved
  // widget uses to live-refresh; aggregate results omit it (they render from the cached sample).
  const store = new Map<string, { sql: string; columns: string[]; rows: Record<string, unknown>[]; firestore?: FirestoreQueryRef }>()
  // charts accepted this run — validateVizProposal rejects the (MAX_CHARTS_PER_RUN+1)th.
  let vizAccepted = 0
  let seq = 0

  const stash = (descriptor: string, columns: string[], rows: Record<string, unknown>[], firestore?: FirestoreQueryRef): string => {
    const queryId = `q${++seq}`
    store.set(queryId, { sql: descriptor, columns, rows, firestore })
    sink?.onQueryResult?.({ queryId, sql: descriptor, columns, rows, firestore })
    return queryId
  }

  return createSdkMcpServer({
    name: 'supalens_firestore',
    instructions: 'Read-only access to a Firebase Firestore project (collections of documents), plus chart proposals.',
    tools: [
      tool(
        'list_collections',
        'List the top-level collection ids in the connected Firestore project. Call this first to discover what data exists.',
        {},
        async () => {
          try {
            const collections = await listCollections(dataSourceId)
            return { content: [{ type: 'text' as const, text: JSON.stringify({ collections }) }] }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `list_collections failed: ${String(e).slice(0, 300)}` }], isError: true }
          }
        }
      ),
      tool(
        'get_collection_schema',
        "Infer a collection's fields and types by SAMPLING documents. Returns {collection, sampled, fields:[{name,types,frequency}]}. This is a SAMPLE, not authoritative — a field present only in unsampled documents may be missing.",
        { collection: z.string().describe('collection id, e.g. "users"') },
        async ({ collection }) => {
          try {
            const schema = await inferCollectionSchema(dataSourceId, collection)
            return { content: [{ type: 'text' as const, text: JSON.stringify(schema) }] }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `get_collection_schema failed: ${String(e).slice(0, 300)}` }], isError: true }
          }
        }
      ),
      tool(
        'query_documents',
        'Read documents from ONE collection with optional where filters, an orderBy, and a limit. Returns JSON {queryId, columns, rows, rowCount, truncated}. Documents are flattened to columns (nested → dot notation; __id is the document id). NO JOINs. Results are capped. Pass the queryId to propose_visualization.',
        {
          collection: z.string(),
          where: z.array(WhereClauseSchema).optional(),
          orderBy: z.object({ field: z.string(), direction: z.enum(['asc', 'desc']).optional() }).optional(),
          limit: z.number().int().positive().max(1000).optional().describe('default 100, max 1000'),
          collectionGroup: z.boolean().optional().describe('query across all sub-collections with this id'),
        },
        async ({ collection, where, orderBy, limit, collectionGroup }) => {
          try {
            const fq = { collection, where, orderBy, limit, collectionGroup }
            const r = await queryDocuments(dataSourceId, fq, { actor, maxRows: 1000 })
            const queryId = stash(describeQuery(fq), r.columns, r.rows, fq)
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ queryId, columns: r.columns, rows: r.rows, rowCount: r.rowCount, truncated: r.truncated }),
                },
              ],
            }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `Query rejected or failed: ${String(e).slice(0, 300)}` }], isError: true }
          }
        }
      ),
      tool(
        'aggregate',
        'Server-side aggregation over a collection: count, or sum/average of a numeric field, with optional where filters. Cheap — PREFER this over reading all documents to total them. Returns {queryId, columns, rows} (a single-row result you can chart).',
        {
          collection: z.string(),
          op: z.enum(['count', 'sum', 'average']),
          field: z.string().optional().describe('required for sum/average'),
          where: z.array(WhereClauseSchema).optional(),
          collectionGroup: z.boolean().optional(),
        },
        async ({ collection, op, field, where, collectionGroup }) => {
          try {
            const r = await aggregateDocuments(dataSourceId, { collection, op, field, where, collectionGroup }, { actor })
            const queryId = stash(`firestore-agg: ${op}(${field ?? '*'}) on ${collection}`, r.columns, r.rows)
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ queryId, columns: r.columns, rows: r.rows, rowCount: r.rowCount }) }],
            }
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `Aggregate failed: ${String(e).slice(0, 300)}` }], isError: true }
          }
        }
      ),
      tool(
        'propose_visualization',
        `Choose and configure ONE chart for a prior result. Pass the queryId returned by query_documents or aggregate and a chart config. Every column the chart references MUST exist in that result. At most ${MAX_CHARTS_PER_RUN} charts are accepted per answer.`,
        ProposeVizInput,
        async ({ queryId, chart }) => {
          const res = validateVizProposal(store, vizAccepted, { queryId, chart }, { queryToolHint: 'query_documents or aggregate' })
          if (!res.ok) {
            return { content: [{ type: 'text' as const, text: res.error }], isError: true }
          }
          sink?.onVisualization(res.spec)
          vizAccepted++
          return { content: [{ type: 'text' as const, text: `Visualization (${chart.type}) accepted: ${chart.title}` }] }
        }
      ),
    ],
  })
}
