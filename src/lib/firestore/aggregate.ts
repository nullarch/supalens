// NOT `import 'server-only'` — runs in the Trigger.dev runtime.
//
// Server-side aggregation (count / sum / average). This is the CHEAP path for analytics on
// Firestore: an aggregation query does NOT stream every matching document to the client (it is
// billed at a small fraction of a full read), so the agent is steered to PREFER this over
// reading a whole collection and aggregating client-side. Firestore has no GROUP BY / JOIN —
// only these single-field aggregates over a (optionally filtered) collection.
import { AggregateField } from '@google-cloud/firestore'
import type { Query, WhereFilterOp } from '@google-cloud/firestore'

import { recordQueryAudit } from '@/lib/query/audit'
import type { QueryResult } from '@/lib/query/types'
import type { Actor } from '@/lib/secrets/service'

import { getFirestore } from './client'
import type { WhereClause } from './query'

export type AggOp = 'count' | 'sum' | 'average'

export interface AggregateSpec {
  collection: string
  op: AggOp
  /** required for sum/average; ignored for count. */
  field?: string
  where?: WhereClause[]
  collectionGroup?: boolean
}

export async function aggregateDocuments(
  dataSourceId: string,
  spec: AggregateSpec,
  opts: { actor: Actor }
): Promise<QueryResult> {
  const started = Date.now()
  const descriptor = `firestore-agg: ${spec.op}(${spec.field ?? '*'}) on ${spec.collectionGroup ? 'group ' : ''}${spec.collection}${
    spec.where?.length ? ' where ' + spec.where.map((w) => `${w.field} ${w.op} ${JSON.stringify(w.value)}`).join(' and ') : ''
  }`
  const { db, orgId } = await getFirestore(dataSourceId)

  try {
    if ((spec.op === 'sum' || spec.op === 'average') && !spec.field) throw new Error(`${spec.op} requires a field`)
    let ref: Query = spec.collectionGroup ? db.collectionGroup(spec.collection) : db.collection(spec.collection)
    for (const w of spec.where ?? []) ref = ref.where(w.field, w.op as WhereFilterOp, w.value)

    const col = spec.op === 'count' ? 'count' : `${spec.op}_${spec.field}`
    let value: number
    if (spec.op === 'count') {
      const res = await ref.count().get()
      value = (res.data() as { count: number }).count
    } else {
      const field = spec.field as string
      const res = await ref
        .aggregate({ value: spec.op === 'sum' ? AggregateField.sum(field) : AggregateField.average(field) })
        .get()
      value = (res.data() as { value: number }).value ?? 0
    }

    const result: QueryResult = {
      columns: [col],
      rows: [{ [col]: value }],
      rowCount: 1,
      truncated: false,
      durationMs: Date.now() - started,
    }
    await recordQueryAudit({
      orgId,
      dataSourceId,
      actor: opts.actor,
      sql: descriptor,
      rowCount: 1,
      durationMs: result.durationMs,
      truncated: false,
    })
    return result
  } catch (error) {
    await recordQueryAudit({ orgId, dataSourceId, actor: opts.actor, sql: descriptor, error })
    throw error
  }
}
