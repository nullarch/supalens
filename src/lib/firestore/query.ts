// NOT `import 'server-only'` — runs in the Trigger.dev runtime. Firestore parallel of
// query/{run,execute}.ts: run ONE read-only document query and return the SAME QueryResult
// contract the SQL engine returns, so the viz layer is reused verbatim.
//
// Read-only is STRUCTURAL: this module exposes only get/where/orderBy/limit — there is no
// set/update/delete path (mirrors code-agent's "no write tool" no-execute invariant). A hard
// row cap is always applied (Firestore bills per document read — an unbounded scan is a cost
// incident), and the model can never request more than MAX_LIMIT.
import type { Query, WhereFilterOp } from '@google-cloud/firestore'

import { recordQueryAudit } from '@/lib/query/audit'
import type { ExecuteOptions, QueryResult } from '@/lib/query/types'
import type { Actor } from '@/lib/secrets/service'

import { getFirestore } from './client'
import { flattenDocuments, type FlatDoc } from './flatten'

export type WhereOp = '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'in' | 'not-in' | 'array-contains-any'

export interface WhereClause {
  field: string
  op: WhereOp
  value: unknown
}

export interface FirestoreQuery {
  collection: string
  where?: WhereClause[]
  orderBy?: { field: string; direction?: 'asc' | 'desc' }
  limit?: number
  /** query across all sub-collections with this id (Firestore collectionGroup). */
  collectionGroup?: boolean
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

/** Human-readable descriptor for the audit trail + the VisualizationSpec.query.sql slot. */
export function describeQuery(q: FirestoreQuery): string {
  const cap = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const parts = [`firestore:${q.collectionGroup ? 'group ' : ''}${q.collection}`]
  if (q.where?.length) parts.push('where ' + q.where.map((w) => `${w.field} ${w.op} ${JSON.stringify(w.value)}`).join(' and '))
  if (q.orderBy) parts.push(`orderBy ${q.orderBy.field} ${q.orderBy.direction ?? 'asc'}`)
  parts.push(`limit ${cap}`)
  return parts.join(' ')
}

function mapFsError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/index/i.test(msg) && /(requires|create|building)/i.test(msg))
    return `This query needs a composite index in Firestore. Simplify the filter/orderBy (e.g. drop a where or the orderBy), or create the index. (${msg.slice(0, 200)})`
  if (/permission|PERMISSION_DENIED/i.test(msg))
    return `Permission denied — the connected service account needs read access (roles/datastore.viewer). (${msg.slice(0, 150)})`
  return msg.slice(0, 300)
}

/**
 * Execute one read-only Firestore query → { columns, rows, rowCount, truncated, durationMs }.
 * Fetches cap+1 docs to detect truncation (mirrors the SQL engine's `LIMIT maxRows+1`).
 */
export async function queryDocuments(
  dataSourceId: string,
  q: FirestoreQuery,
  opts: ExecuteOptions & { actor: Actor }
): Promise<QueryResult> {
  const started = Date.now()
  const descriptor = describeQuery(q)
  const cap = Math.min(q.limit ?? DEFAULT_LIMIT, opts.maxRows ?? MAX_LIMIT, MAX_LIMIT)
  const { db, orgId } = await getFirestore(dataSourceId)

  try {
    let ref: Query = q.collectionGroup ? db.collectionGroup(q.collection) : db.collection(q.collection)
    for (const w of q.where ?? []) ref = ref.where(w.field, w.op as WhereFilterOp, w.value)
    if (q.orderBy) ref = ref.orderBy(q.orderBy.field, q.orderBy.direction ?? 'asc')
    ref = ref.limit(cap + 1)

    const snap = await ref.get()
    const truncated = snap.docs.length > cap
    const docs: FlatDoc[] = snap.docs
      .slice(0, cap)
      .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    const { columns, rows } = flattenDocuments(docs)

    const result: QueryResult = { columns, rows, rowCount: rows.length, truncated, durationMs: Date.now() - started }
    await recordQueryAudit({
      orgId,
      dataSourceId,
      actor: opts.actor,
      sql: descriptor,
      rowCount: result.rowCount,
      durationMs: result.durationMs,
      truncated,
    })
    return result
  } catch (error) {
    await recordQueryAudit({ orgId, dataSourceId, actor: opts.actor, sql: descriptor, error })
    throw new Error(mapFsError(error))
  }
}
