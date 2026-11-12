// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev agent
// runtime (same convention as the rest of src/lib/query).
import { getCachedAccessToken, invalidateAccessToken } from '@/lib/supabase-oauth/tokens'
import { ManagementApiError, SupabaseManagementClient } from '@/lib/supabase-management/client'
import { SYSTEM_SCHEMAS } from '@/lib/supabase-management/bootstrap'
import { assertReadOnly, stripTrailingSemicolon, UnsafeSqlError } from './guard'
import type { ExecuteOptions, QueryResult } from './types'

const DEFAULT_MAX_ROWS = 1000
const DEFAULT_TIMEOUT_MS = 30_000

/** The Management-API query target a Supabase-OAuth data source resolves to (query/dsn.ts). */
export interface SupabaseApiTarget {
  connectionId: string
  projectRef: string
}

/**
 * System-schema deny-list for API-transport SQL. The Management API runs SQL with OWNER
 * privileges (that is WHY it bypasses tenant RLS — the point of this transport), which also
 * means it could read `vault.decrypted_secrets`, `auth.users`, `extensions.pg_stat_statements`
 * (raw SQL text incl. literals), etc. The pooler transport blocks those STRUCTURALLY (the
 * supalens_ro role has no grants there); this transport can only block them at the SQL layer.
 *
 * This is a BEST-EFFORT lexical guard, not a structural boundary (exotic encodings or
 * SECURITY DEFINER functions inside the tenant DB can evade a lexer) — the accepted residual
 * risk of the Management-API transport. It rejects schema-qualified references to the same
 * SYSTEM_SCHEMAS the pooler role is denied, plus pg_stat_statements by name.
 */
const SYSTEM_SCHEMA_REF = new RegExp(
  `(?:^|[^a-z0-9_])(?:${[...SYSTEM_SCHEMAS, 'pg_catalog'].join('|')})\\s*\\.|pg_stat_statements`,
  'i'
)

export function assertNoSystemSchemaRefs(sql: string): void {
  // strip identifier quotes so `"vault"."secrets"` is seen as `vault.secrets`
  const normalized = sql.replace(/"/g, '')
  if (SYSTEM_SCHEMA_REF.test(normalized)) {
    throw new UnsafeSqlError(
      'query references a protected system schema (auth/vault/storage/extensions/…) — ' +
        'only application schemas are queryable on this data source'
    )
  }
}

/**
 * Execute read-only SQL against a Supabase-OAuth data source via the Management API
 * (`POST /v1/projects/{ref}/database/query`, `read_only: true`).
 *
 * Why this transport exists: the pooler role (supalens_ro) cannot bypass tenant RLS
 * (BYPASSRLS is not grantable on hosted Supabase), so RLS-enabled tables read as 0 rows.
 * The Management API executes as the table owner, so RLS does not restrict results —
 * "connect and it just works". Trade-offs vs the pooler: per-query HTTPS latency and the
 * Management API rate limit (~120 req/min per user+scope; 429 surfaces as a clear error).
 *
 * Defense-in-depth, mirroring executeReadOnlyWithConfig: SELECT-only guard + system-schema
 * deny-list (above) + a server-side READ ONLY transaction (`read_only: true`) + DB-enforced
 * statement_timeout + a hard row cap (LIMIT at the DB).
 */
export async function executeViaManagementApi(
  target: SupabaseApiTarget,
  sql: string,
  opts: ExecuteOptions & {
    /**
     * Allow pg_catalog/information_schema references for MODULE-INTERNAL introspection SQL
     * (query/introspect.ts). Never set for user/model-authored SQL — executeReadOnly (run.ts)
     * does not pass it.
     */
    trustedCatalogQuery?: boolean
  } = {}
): Promise<QueryResult> {
  assertReadOnly(sql)
  if (!opts.trustedCatalogQuery) assertNoSystemSchemaRefs(sql)

  const maxRows = Math.max(1, Math.floor(opts.maxRows ?? DEFAULT_MAX_ROWS))
  const timeoutMs = Math.max(1, Math.floor(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const inner = stripTrailingSemicolon(sql)
  // the endpoint runs the whole body in one transaction and returns the LAST statement's
  // result, so `set local` scopes the timeout to exactly this query (SQL-editor semantics)
  const wrapped = `set local statement_timeout = ${timeoutMs}; select * from (${inner}) as _supalens_q limit ${maxRows + 1}`
  const started = Date.now()

  const run = async (): Promise<unknown> => {
    const token = await getCachedAccessToken(target.connectionId)
    return new SupabaseManagementClient(token).runQuery(target.projectRef, wrapped, { readOnly: true })
  }

  let raw: unknown
  try {
    raw = await run()
  } catch (err) {
    if (err instanceof ManagementApiError && err.status === 401) {
      // cached token went stale/revoked mid-flight — refresh once and retry
      invalidateAccessToken(target.connectionId)
      raw = await run()
    } else if (err instanceof ManagementApiError && err.status === 429) {
      throw new Error(
        `Supabase Management API rate limit reached (429)${err.retryAfterSeconds ? ` — retry in ~${err.retryAfterSeconds}s` : ''}`
      )
    } else {
      throw err
    }
  }

  // response is the raw result set: an array of row objects (SQL-editor shape)
  const rows = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[]
  const truncated = rows.length > maxRows
  const capped = truncated ? rows.slice(0, maxRows) : rows
  return {
    // column names come from row keys — an empty result has no column metadata over this
    // transport (unlike the pg driver's field descriptors)
    columns: capped.length > 0 ? Object.keys(capped[0]) : [],
    rows: capped,
    rowCount: capped.length,
    truncated,
    durationMs: Date.now() - started,
  }
}
