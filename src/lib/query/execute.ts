import type { RowDataPacket, FieldPacket } from 'mysql2/promise'

import { assertReadOnly, stripTrailingSemicolon } from './guard'
import { getPool } from './pool'
import type { ConnectionConfig, ExecuteOptions, QueryResult } from './types'

const DEFAULT_MAX_ROWS = 1000
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Low-level read-only execution against a resolved connection. No vault/audit — used
 * directly by tests and introspection. Defense-in-depth: SELECT-only guard + a READ ONLY
 * transaction + a DB-enforced statement timeout + a hard row cap (LIMIT at the DB).
 */
export async function executeReadOnlyWithConfig(
  poolKey: string,
  cfg: ConnectionConfig,
  sql: string,
  opts: ExecuteOptions = {}
): Promise<QueryResult> {
  assertReadOnly(sql)
  const maxRows = Math.max(1, Math.floor(opts.maxRows ?? DEFAULT_MAX_ROWS))
  const timeoutMs = Math.max(1, Math.floor(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const inner = stripTrailingSemicolon(sql)
  // wrap so the row cap is enforced at the DB; fetch one extra to detect truncation
  const wrapped = `select * from (${inner}) as _supalens_q limit ${maxRows + 1}`
  const started = Date.now()
  const p = getPool(poolKey, cfg)

  if (p.kind === 'pg') {
    const client = await p.pool.connect()
    try {
      await client.query('begin read only')
      await client.query(`set local statement_timeout = ${timeoutMs}`)
      const res = await client.query(wrapped)
      await client.query('commit')
      const truncated = res.rows.length > maxRows
      const rows = (truncated ? res.rows.slice(0, maxRows) : res.rows) as Record<string, unknown>[]
      return {
        columns: res.fields.map((f) => f.name),
        rows,
        rowCount: rows.length,
        truncated,
        durationMs: Date.now() - started,
      }
    } catch (err) {
      try {
        await client.query('rollback')
      } catch {
        /* ignore */
      }
      throw err
    } finally {
      client.release()
    }
  }

  // mysql
  const conn = await p.pool.getConnection()
  try {
    await conn.query('start transaction read only')
    await conn.query(`set session max_execution_time = ${timeoutMs}`)
    const [rowsRaw, fields] = (await conn.query(wrapped)) as [RowDataPacket[], FieldPacket[]]
    await conn.query('commit')
    const all = rowsRaw as unknown as Record<string, unknown>[]
    const truncated = all.length > maxRows
    const rows = truncated ? all.slice(0, maxRows) : all
    return {
      columns: (fields ?? []).map((f) => f.name),
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    try {
      await conn.query('rollback')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    conn.release()
  }
}
