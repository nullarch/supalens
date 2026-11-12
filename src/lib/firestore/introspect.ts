// NOT `import 'server-only'` — runs in the Trigger.dev runtime. Firestore parallel of
// query/introspect.ts (getSchema). Firestore has NO schema catalog (no information_schema): a
// collection holds heterogeneous documents. So we list collections and INFER a collection's
// shape by sampling N documents and unioning their (flattened) field keys + observed types.
// This is a SAMPLE, not authoritative — fields present only in unsampled docs are missed; the
// agent prompt is told to treat it as such.
import { getFirestore } from './client'
import { flattenDocuments } from './flatten'

export interface CollectionField {
  name: string
  /** observed JS types across the sample, e.g. ['string'] or ['number','null']. */
  types: string[]
  /** fraction of sampled docs that had this field (0..1). */
  frequency: number
}

export interface CollectionSchema {
  collection: string
  sampled: number
  fields: CollectionField[]
}

const DEFAULT_SAMPLE = 50
const MAX_SAMPLE = 500

/** Top-level collection ids for the project. */
export async function listCollections(dataSourceId: string): Promise<string[]> {
  const { db } = await getFirestore(dataSourceId)
  const cols = await db.listCollections()
  return cols.map((c) => c.id)
}

/** Infer a collection's field set/types by sampling documents (uses the same flatten as queries). */
export async function inferCollectionSchema(
  dataSourceId: string,
  collection: string,
  sampleSize: number = DEFAULT_SAMPLE
): Promise<CollectionSchema> {
  const { db } = await getFirestore(dataSourceId)
  const snap = await db.collection(collection).limit(Math.min(sampleSize, MAX_SAMPLE)).get()
  const sampled = snap.docs.length

  const acc = new Map<string, { types: Set<string>; count: number }>()
  for (const d of snap.docs) {
    const { columns, rows } = flattenDocuments([{ id: d.id, data: d.data() as Record<string, unknown> }])
    const row = rows[0] ?? {}
    for (const col of columns) {
      if (col === '__id') continue
      const v = row[col]
      const entry = acc.get(col) ?? { types: new Set<string>(), count: 0 }
      entry.types.add(v === null ? 'null' : typeof v)
      entry.count += 1
      acc.set(col, entry)
    }
  }

  const fields: CollectionField[] = [...acc.entries()].map(([name, { types, count }]) => ({
    name,
    types: [...types],
    frequency: sampled ? Number((count / sampled).toFixed(2)) : 0,
  }))
  return { collection, sampled, fields }
}
