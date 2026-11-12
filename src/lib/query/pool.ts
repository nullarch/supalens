import { Pool as PgPool } from 'pg'
import mysql, { type Pool as MyPool } from 'mysql2/promise'

import type { ConnectionConfig } from './types'

/**
 * Per-data-source connection pool cache (module-global). On Trigger.dev's long-lived
 * container these pools stay warm across runs; on Vercel they live per warm instance.
 * Keyed by data source id. Small max — server-side pooling is Supavisor's job.
 */
export type AnyPool = { kind: 'pg'; pool: PgPool } | { kind: 'mysql'; pool: MyPool }

const pools = new Map<string, AnyPool>()

export function getPool(key: string, cfg: ConnectionConfig): AnyPool {
  const hit = pools.get(key)
  if (hit) return hit

  // TLS verifies certs by default. When the host is an SSRF-pinned IP literal, `servername`
  // carries the original hostname so cert verification + SNI still work. DB_TLS_INSECURE=true
  // is an explicit opt-out for self-hosted DBs with self-signed certs (do not set in prod).
  // ssl:'require' = libpq sslmode=require semantics (encrypt, skip chain verification) — the
  // supabase-oauth pooler path uses it; Supavisor certs chain to Supabase's own CA and fail
  // full verification with "self-signed certificate in certificate chain".
  const insecure = process.env.DB_TLS_INSECURE === 'true'
  const skipVerify = insecure || cfg.ssl === 'require'
  const sslOpt = cfg.ssl
    ? { rejectUnauthorized: !skipVerify, ...(cfg.servername ? { servername: cfg.servername } : {}) }
    : undefined

  let entry: AnyPool
  if (cfg.engine !== 'postgres' && cfg.engine !== 'mysql') {
    // cfg.engine is a cast from the (wider) DB enum — never treat an unknown engine as mysql
    throw new Error(`unsupported SQL engine: ${String(cfg.engine)}`)
  }
  if (cfg.engine === 'postgres') {
    entry = {
      kind: 'pg',
      pool: new PgPool({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.user,
        password: cfg.password,
        ssl: sslOpt,
        max: 4,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      }),
    }
  } else {
    entry = {
      kind: 'mysql',
      pool: mysql.createPool({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.user,
        password: cfg.password,
        ssl: sslOpt,
        connectionLimit: 4,
        connectTimeout: 10_000,
        // Supavisor is Postgres-only; MySQL sources connect directly / via their own pooler.
      }),
    }
  }
  pools.set(key, entry)
  return entry
}

export async function closePool(key: string): Promise<void> {
  const p = pools.get(key)
  if (!p) return
  pools.delete(key)
  try {
    await p.pool.end()
  } catch {
    /* ignore */
  }
}
