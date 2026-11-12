import 'server-only'

import { createHash } from 'crypto'

import { unstable_cache } from 'next/cache'
import type { FirestoreQueryRef, WidgetData } from '@/lib/viz/spec'

/**
 * Re-run a saved widget's SQL against its connected data source (read-only, capped,
 * audited — via the shared query engine) to refresh widgets that have no cached
 * `sample`. Cached per widget; returns null on ANY failure (no/unresolved data
 * source, query error, query-engine env missing) so a widget degrades to an empty
 * state instead of breaking the whole dashboard.
 */
export async function runWidgetData(
  widgetId: string,
  dataSourceId: string,
  query: { sql: string; firestore?: FirestoreQueryRef },
  userId: string,
  refreshInterval?: number | null
): Promise<WidgetData | null> {
  // Include a hash of the QUERY in the cache key. The key previously keyed only on
  // [widgetId, dataSourceId], so after an SQL/descriptor edit the cache kept serving the OLD
  // query's result (up to refresh_interval seconds — unbounded on the high end) as if it were
  // live. Hashing the query means an edit yields a NEW key → a fresh run immediately, and the
  // stale entry simply expires. (revalidateTag(`widget:${id}`) still works for manual busting.)
  const queryHash = createHash('sha1')
    .update(query.firestore ? JSON.stringify(query.firestore) : query.sql)
    .digest('hex')
    .slice(0, 16)
  const load = unstable_cache(
    async (): Promise<WidgetData | null> => {
      try {
        const actor = { kind: 'user' as const, id: userId }
        // Firestore-backed widget → re-run the structured document query; else the SQL string.
        if (query.firestore) {
          const { queryDocuments } = await import('@/lib/firestore')
          const res = await queryDocuments(dataSourceId, query.firestore, { actor, maxRows: 1000 })
          return { columns: res.columns, rows: res.rows, truncated: res.truncated, rowCount: res.rowCount }
        }
        const { executeReadOnly } = await import('@/lib/query')
        const res = await executeReadOnly(dataSourceId, query.sql, { actor, maxRows: 1000 })
        return { columns: res.columns, rows: res.rows, truncated: res.truncated, rowCount: res.rowCount }
      } catch {
        return null
      }
    },
    ['dashboard-widget-data', widgetId, dataSourceId, queryHash],
    { revalidate: refreshInterval && refreshInterval > 0 ? refreshInterval : 60, tags: [`widget:${widgetId}`] }
  )
  return load()
}
