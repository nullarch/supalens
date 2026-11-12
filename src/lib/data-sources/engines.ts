/**
 * Engine-family registry — the ONE place that says which `data_sources.engine` values are
 * SQL-shaped. Every place that branches per engine must go through these helpers (whitelist)
 * instead of `engine !== 'firestore'` blacklists: a blacklist silently routes a FUTURE engine
 * down the SQL path, where it fails deep in the query engine with an opaque credential error
 * (or worse, half-works). With a whitelist, an unhandled engine fails closed with a clear
 * message at the seam that forgot about it.
 *
 * Adding an engine family: extend the union(s) here, then follow the compiler/runtime errors —
 * taskIdForEngine / runByEngine / introspect-cache / MCP resolvers all throw on unknown engines.
 *
 * NOT `import 'server-only'` — shared with the Trigger.dev runtime (same convention as
 * src/lib/query/*).
 */

export const SQL_ENGINES = ['postgres', 'mysql'] as const
export type SqlEngine = (typeof SQL_ENGINES)[number]

export const DOCUMENT_ENGINES = ['firestore'] as const
export type DocumentEngine = (typeof DOCUMENT_ENGINES)[number]

export type KnownEngine = SqlEngine | DocumentEngine

/** True when the engine speaks SQL (executeReadOnly / getSchema / alerts / KPI extraction apply). */
export function isSqlEngine(engine: string | null | undefined): engine is SqlEngine {
  return (SQL_ENGINES as readonly string[]).includes(engine ?? '')
}

/** True when the engine is a document store (Firestore family). */
export function isDocumentEngine(engine: string | null | undefined): engine is DocumentEngine {
  return (DOCUMENT_ENGINES as readonly string[]).includes(engine ?? '')
}
