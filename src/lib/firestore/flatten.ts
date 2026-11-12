// Pure document→table adapter. This is the ONLY seam that makes Firestore reuse the entire
// viz/widget stack: it turns a set of heterogeneous JSON documents into the exact
// { columns, rows } contract the SQL engine returns (query/types.ts QueryResult), keyed by
// column name — so WidgetRenderer, charts, and propose_visualization work unchanged.
//
// Semantic-loss rules (documented on purpose): nested objects → dot-notation columns
// (`address.city`); arrays → JSON string (not expanded into columns); Firestore Timestamp /
// JS Date → ISO string; GeoPoint → "lat,lng"; DocumentReference → its path; Bytes → a marker.
// The document id is surfaced as the reserved column `__id` (double underscore avoids
// collision with a user field literally named "id").
import { Timestamp, GeoPoint, DocumentReference } from '@google-cloud/firestore'

/** Reserved column holding the Firestore document id. */
export const FIRESTORE_ID_COLUMN = '__id'

export interface FlatDoc {
  id: string
  data: Record<string, unknown>
}

/** Flatten one field value into `out` under `prefix` (recursing for plain objects). */
function flattenInto(out: Record<string, unknown>, prefix: string, value: unknown): void {
  if (value === null || value === undefined) {
    out[prefix] = null
    return
  }
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') {
    out[prefix] = value
    return
  }
  if (t === 'bigint') {
    out[prefix] = (value as bigint).toString()
    return
  }
  // Order matters: these are all `typeof === 'object'`, so match them BEFORE the plain-object
  // branch. instanceof (not duck-typing) so a plain map like {latitude,longitude} is NOT
  // mistaken for a GeoPoint — it correctly flattens into `.latitude` / `.longitude` columns.
  if (value instanceof Timestamp) {
    out[prefix] = value.toDate().toISOString()
    return
  }
  if (value instanceof Date) {
    out[prefix] = value.toISOString()
    return
  }
  if (value instanceof GeoPoint) {
    out[prefix] = `${value.latitude},${value.longitude}`
    return
  }
  if (value instanceof DocumentReference) {
    out[prefix] = value.path
    return
  }
  if (value instanceof Uint8Array) {
    out[prefix] = `[bytes:${value.length}]`
    return
  }
  if (Array.isArray(value)) {
    out[prefix] = JSON.stringify(value)
    return
  }
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      out[prefix] = '{}'
      return
    }
    for (const [k, v] of entries) flattenInto(out, prefix ? `${prefix}.${k}` : k, v)
    return
  }
  out[prefix] = String(value)
}

/**
 * Flatten a set of documents into { columns, rows }. `columns` is the union of all flattened
 * field keys (first-seen order, `__id` first); every row carries every column (missing → null)
 * so the shape is a stable rectangle the widgets can index by name.
 */
export function flattenDocuments(docs: FlatDoc[]): { columns: string[]; rows: Record<string, unknown>[] } {
  const columns: string[] = [FIRESTORE_ID_COLUMN]
  const seen = new Set<string>([FIRESTORE_ID_COLUMN])
  const rows: Record<string, unknown>[] = []

  for (const doc of docs) {
    const flat: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(doc.data ?? {})) flattenInto(flat, k, v)

    const row: Record<string, unknown> = { [FIRESTORE_ID_COLUMN]: doc.id }
    for (const [k0, v] of Object.entries(flat)) {
      // `__id` is RESERVED for the document id — a user field literally named "__id" must not
      // overwrite it (charts keyed on __id would silently show the field, not the doc id).
      // Remap such a field to the first free `__id_`-suffixed name instead of dropping it.
      let k = k0
      while (k === FIRESTORE_ID_COLUMN || (k !== k0 && k in row)) k = `${k}_`
      if (!seen.has(k)) {
        seen.add(k)
        columns.push(k)
      }
      row[k] = v
    }
    rows.push(row)
  }

  // rectangularize: every row has every column (charts assume a stable column set)
  for (const row of rows) for (const c of columns) if (!(c in row)) row[c] = null
  return { columns, rows }
}
