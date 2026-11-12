export type DataSourceEngine = 'postgres' | 'mysql'

/** Resolved connection details for one data source (password already decrypted). */
export interface ConnectionConfig {
  engine: DataSourceEngine
  /** the address we actually connect to — a validated IP literal when SSRF-pinned. */
  host: string
  port: number
  database: string
  user: string
  password: string
  /**
   * TLS mode. `true` = encrypt + verify the chain (public CA). `'require'` = libpq
   * sslmode=require semantics: encrypt but do NOT verify the chain — needed for managed
   * poolers whose certs chain to a provider CA (e.g. Supabase Supavisor rejects with
   * "self-signed certificate in certificate chain" under full verification); the
   * supabase-oauth bootstrap stores this mode.
   */
  ssl?: boolean | 'require'
  /** original hostname for TLS SNI / cert verification when `host` is a pinned IP. */
  servername?: string
}

export interface ExecuteOptions {
  /** hard cap on returned rows (excess sets truncated=true). default 1000 */
  maxRows?: number
  /** per-statement timeout in ms (enforced at the DB). default 30000 */
  timeoutMs?: number
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
  durationMs: number
}
