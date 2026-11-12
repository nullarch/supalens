import { requireAdminClient } from '@/utils/supabase/admin'
import { getCurrentSecret, revealSecret } from '@/lib/secrets/service'
import { resolveSafeHost } from '@/lib/data-sources/ssrf'
import { isSqlEngine } from '@/lib/data-sources/engines'
import type { ConnectionConfig, DataSourceEngine } from './types'

interface ResolvedDataSource {
  orgId: string
  expiresAt: number
  /** pool transport (direct DB / demo / mysql) — absent when `supabaseApi` is set. */
  cfg?: ConnectionConfig
  /**
   * Management-API transport for Supabase-OAuth sources: owner-level `read_only` queries via
   * `POST /v1/projects/{ref}/database/query`, so tenant RLS does not zero out results
   * (docs/supabase.md §6 #1). No vault reveal / SSRF pin needed — fixed Supabase API host.
   */
  supabaseApi?: { connectionId: string; projectRef: string }
}

// cache resolved config (incl. decrypted password) so we reveal the secret once per
// pool lifetime rather than per query. TTL-bounded so decrypted creds don't live forever
// on the warm Trigger.dev container, and invalidated explicitly on disconnect/rotation.
const CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, ResolvedDataSource>()

/**
 * Resolve a data source to its query transport: read the (non-secret) config row via the
 * service-role client, then either return a Management-API target (Supabase-OAuth sources)
 * or decrypt the current db_password from the vault for a direct pool connection.
 */
export async function resolveDataSource(dataSourceId: string): Promise<ResolvedDataSource> {
  const hit = cache.get(dataSourceId)
  if (hit && hit.expiresAt > Date.now()) return hit
  if (hit) cache.delete(dataSourceId) // expired — re-resolve (re-checks deleted_at + secret)

  const admin = requireAdminClient()
  const { data, error } = await admin
    .from('data_sources')
    .select('id, org_id, engine, provider, connection_id, config, status, deleted_at, is_demo')
    .eq('id', dataSourceId)
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`data source not found: ${dataSourceId}`)
  const ds = data[0] as {
    org_id: string
    engine: DataSourceEngine
    provider: string | null
    connection_id: string | null
    config: Record<string, unknown> | null
    deleted_at: string | null
    is_demo?: boolean
  }
  if (ds.deleted_at) throw new Error(`data source is deleted: ${dataSourceId}`)
  // Fail closed with a CLEAR error for non-SQL engines (the DB enum is wider than this
  // module's DataSourceEngine — a firestore/future id used to die later with an opaque
  // "no db_password secret", or worse, fall into the mysql pool branch).
  if (!isSqlEngine(ds.engine)) {
    throw new Error(`data source ${dataSourceId} is not a SQL engine (engine=${ds.engine}) — the SQL query engine cannot run it`)
  }

  // Demo source: creds come from the DEMO_DATABASE_URL host env (a shared read-only sample DB),
  // not the per-tenant vault. Trusted env host → no SSRF re-pin needed.
  if (ds.is_demo) {
    const url = process.env.DEMO_DATABASE_URL
    if (!url) throw new Error('DEMO_DATABASE_URL is not configured')
    const u = new URL(url)
    const resolved: ResolvedDataSource = {
      orgId: ds.org_id,
      cfg: {
        engine: 'postgres',
        host: u.hostname,
        port: u.port ? Number(u.port) : 5432,
        database: u.pathname.replace(/^\//, '') || 'postgres',
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        ssl: u.searchParams.get('sslmode') !== 'disable',
      },
      expiresAt: Date.now() + CACHE_TTL_MS,
    }
    cache.set(dataSourceId, resolved)
    return resolved
  }

  // Supabase-OAuth source: route queries through the Management API (owner-level, read_only)
  // instead of the pooler — supalens_ro cannot bypass tenant RLS, the API can. No password
  // reveal and no SSRF pin (fixed api.supabase.com host). Sources without a project_ref
  // (shouldn't exist — the bootstrap keys on it) fall through to the pooler path.
  const projectRef = String((ds.config ?? {}).project_ref ?? '')
  if (ds.provider === 'supabase' && ds.connection_id && projectRef) {
    const resolved: ResolvedDataSource = {
      orgId: ds.org_id,
      supabaseApi: { connectionId: ds.connection_id, projectRef },
      expiresAt: Date.now() + CACHE_TTL_MS,
    }
    cache.set(dataSourceId, resolved)
    return resolved
  }

  const secret = await getCurrentSecret({ kind: 'db_password', parent: { dataSourceId } })
  if (!secret) throw new Error(`no db_password secret for data source: ${dataSourceId}`)
  const password = await revealSecret(secret.id, { actor: { kind: 'system' }, purpose: 'query_engine_connect' })

  const c = ds.config ?? {}
  const host = String(c.pooler_host ?? c.host ?? '')
  const port = Number(c.pooler_port ?? c.port ?? (ds.engine === 'mysql' ? 3306 : 5432))
  const database = String(c.database ?? 'postgres')
  const user = String(c.db_user ?? '')
  if (!host || !user) throw new Error(`data source config missing host/db_user: ${dataSourceId}`)

  // SSRF on the CONNECT path (not just at registration): resolve + validate every address
  // and pin a validated IP so the driver cannot DNS-rebind to an internal target. Throws
  // (fail-closed) if the host now resolves private — the cache TTL re-validates every few min.
  const pinned = await resolveSafeHost(host)

  const resolved: ResolvedDataSource = {
    orgId: ds.org_id,
    cfg: {
      engine: ds.engine,
      host: pinned.ip,
      port,
      database,
      user,
      password,
      // preserve the 'require' TLS mode (encrypt, no chain verify — provider-CA poolers);
      // Boolean() would silently upgrade it to full verification, which Supavisor fails.
      ssl: c.ssl === 'require' ? 'require' : Boolean(c.ssl),
      servername: pinned.ip !== pinned.original ? pinned.original : undefined,
    },
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
  cache.set(dataSourceId, resolved)
  return resolved
}

/** Drop cached credentials + (caller should also close the pool) on disconnect/rotation. */
export function invalidateDataSource(dataSourceId: string): void {
  cache.delete(dataSourceId)
}
