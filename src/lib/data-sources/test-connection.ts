import { randomUUID } from 'crypto'

import { closePool, executeReadOnlyWithConfig, type ConnectionConfig } from '@/lib/query'

/**
 * Probe a connection config with a trivial read-only query. Uses a throwaway pool key so
 * a failed/registration probe never pollutes the long-lived per-data-source pool. Assumes
 * the caller has already run assertSafeHost(cfg.host) (SSRF guard).
 */
export async function testConnection(cfg: ConnectionConfig): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
  const key = `probe:${randomUUID()}`
  const start = Date.now()
  try {
    await executeReadOnlyWithConfig(key, cfg, 'select 1', { maxRows: 1, timeoutMs: 8_000 })
    return { ok: true, latencyMs: Date.now() - start }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  } finally {
    await closePool(key)
  }
}
