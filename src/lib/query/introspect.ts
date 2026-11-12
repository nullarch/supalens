import { SYSTEM_SCHEMAS } from '@/lib/supabase-management/bootstrap'

import { resolveDataSource } from './dsn'
import { executeReadOnlyWithConfig } from './execute'
import { executeViaManagementApi } from './supabase-api'
import type { ConnectionConfig, ExecuteOptions, QueryResult } from './types'

export interface SchemaTable {
  schema: string
  table: string
  /**
   * Postgres only: row-level security is ENABLED on this table AND the connection cannot
   * bypass it. Set only on the pooler transport — our read-only role does not have BYPASSRLS
   * (hosted Supabase forbids granting it), so an RLS table can return FEWER or ZERO rows than
   * actually exist; a "0 rows" there means "possibly restricted", NOT "empty". The
   * Management-API transport (Supabase-OAuth sources) executes as owner, so RLS does not
   * restrict it and this flag is never set. Surfaced to the agent via `rlsSchemaNote`.
   * See docs/supabase.md §6.
   */
  rlsEnabled?: boolean
  columns: { name: string; type: string; nullable: boolean }[]
}

/** SQL list literal of system schemas to hide from API-transport introspection. */
function systemSchemaList(): string {
  return [...SYSTEM_SCHEMAS, 'pg_catalog', 'information_schema'].map((s) => `'${s}'`).join(', ')
}

/**
 * Introspect a data source's tables/columns via information_schema (read-only).
 * Used by the agent's `get_schema` tool and the schema cache.
 *
 * Transport note: on the Management-API path the SQL runs with OWNER privileges, so
 * information_schema would list auth/vault/storage/… — those are explicitly excluded so
 * system schemas never enter the agent's schema view (the pooler path hides them
 * structurally via the supalens_ro grants instead).
 */
export async function getSchema(dataSourceId: string, schemaFilter?: string): Promise<SchemaTable[]> {
  const resolved = await resolveDataSource(dataSourceId)
  const api = resolved.supabaseApi
  const engine = api ? 'postgres' : resolved.cfg!.engine
  const exec = (sql: string, opts: ExecuteOptions): Promise<QueryResult> =>
    api
      ? executeViaManagementApi(api, sql, { ...opts, trustedCatalogQuery: true })
      : executeReadOnlyWithConfig(dataSourceId, resolved.cfg!, sql, opts)

  const safe = schemaFilter ? schemaFilter.replace(/[^a-zA-Z0-9_]/g, '') : null

  let sql: string
  if (engine === 'postgres') {
    sql = `select table_schema, table_name, column_name, data_type, is_nullable, ordinal_position
           from information_schema.columns
           where table_schema not in (${api ? systemSchemaList() : `'pg_catalog', 'information_schema'`})
           ${safe ? `and table_schema = '${safe}'` : ''}
           order by table_schema, table_name, ordinal_position`
  } else {
    sql = `select table_schema, table_name, column_name, data_type, is_nullable, ordinal_position
           from information_schema.columns
           where table_schema = ${safe ? `'${safe}'` : 'database()'}
           order by table_schema, table_name, ordinal_position`
  }

  const res = await exec(sql, { maxRows: 10_000, timeoutMs: 15_000 })

  const tables = new Map<string, SchemaTable>()
  for (const r of res.rows) {
    const key = `${r.table_schema}.${r.table_name}`
    let t = tables.get(key)
    if (!t) {
      t = { schema: String(r.table_schema), table: String(r.table_name), columns: [] }
      tables.set(key, t)
    }
    t.columns.push({
      name: String(r.column_name),
      type: String(r.data_type),
      nullable: String(r.is_nullable).toLowerCase() === 'yes',
    })
  }

  // RLS advisory applies to the pooler transport only — the API transport reads as owner.
  if (!api && engine === 'postgres') {
    for (const key of await fetchRlsTables(dataSourceId, resolved.cfg!, safe)) {
      const t = tables.get(key)
      if (t) t.rlsEnabled = true
    }
  }

  return [...tables.values()]
}

/**
 * Postgres pooler transport: the set of `schema.table` keys with row-level security ENABLED,
 * restricted to tables the read-only role can actually see. Best-effort — RLS awareness is
 * advisory, so a failure here must not fail introspection.
 */
async function fetchRlsTables(
  dataSourceId: string,
  cfg: ConnectionConfig,
  safe: string | null
): Promise<Set<string>> {
  const sql = `select n.nspname as table_schema, c.relname as table_name
               from pg_catalog.pg_class c
               join pg_catalog.pg_namespace n on n.oid = c.relnamespace
               where c.relkind in ('r', 'p')
                 and c.relrowsecurity
                 and n.nspname not in ('pg_catalog', 'information_schema')
                 ${safe ? `and n.nspname = '${safe}'` : ''}`
  try {
    const res = await executeReadOnlyWithConfig(dataSourceId, cfg, sql, { maxRows: 10_000, timeoutMs: 15_000 })
    return new Set(res.rows.map((r) => `${r.table_schema}.${r.table_name}`))
  } catch {
    return new Set()
  }
}

/**
 * A note to prepend to a `get_schema` result when any table has RLS enabled, so the agent
 * does not report an RLS-restricted "0 rows" as "the table is empty". Pure/testable.
 * (Never fires for Supabase-OAuth sources — their transport bypasses RLS, so `rlsEnabled`
 * is not set there.)
 */
export function rlsSchemaNote(tables: SchemaTable[]): string {
  return tables.some((t) => t.rlsEnabled)
    ? 'NOTE: tables marked "rlsEnabled": true have Postgres row-level security enabled. This ' +
        'read-only connection cannot bypass RLS, so those tables can return FEWER or ZERO rows ' +
        'than actually exist. If a query on an rlsEnabled table returns 0 or surprisingly few ' +
        'rows, treat it as possibly access-restricted by RLS — do NOT conclude the table is ' +
        'empty; say the data may be restricted.\n\n'
    : ''
}
