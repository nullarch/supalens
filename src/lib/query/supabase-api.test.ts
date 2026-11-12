import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * executeViaManagementApi — the Management-API query transport for Supabase-OAuth sources.
 * Invariants under test:
 *   - read_only: true is ALWAYS sent (server-side READ ONLY transaction — the no-write guard)
 *   - the SELECT-only guard + system-schema deny-list run BEFORE any network call
 *   - the row cap wraps the SQL at the DB and truncation is detected (maxRows + 1 probe)
 *   - a 401 invalidates the cached token and retries exactly once
 *   - a 429 surfaces as a clear rate-limit error
 */

const getCachedAccessToken = vi.fn()
const invalidateAccessToken = vi.fn()
const runQuery = vi.fn()

vi.mock('@/lib/supabase-oauth/tokens', () => ({
  getCachedAccessToken: (...a: unknown[]) => getCachedAccessToken(...a),
  invalidateAccessToken: (...a: unknown[]) => invalidateAccessToken(...a),
}))
vi.mock('@/lib/supabase-management/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/supabase-management/client')>()
  return {
    ManagementApiError: orig.ManagementApiError,
    SupabaseManagementClient: class {
      constructor(readonly token: string) {}
      runQuery(ref: string, sql: string, opts?: { readOnly?: boolean }) {
        return runQuery(this.token, ref, sql, opts)
      }
    },
  }
})

import { ManagementApiError } from '@/lib/supabase-management/client'
import { assertNoSystemSchemaRefs, executeViaManagementApi } from './supabase-api'

const TARGET = { connectionId: 'conn-1', projectRef: 'refabc' }

beforeEach(() => {
  getCachedAccessToken.mockReset().mockResolvedValue('tok-1')
  invalidateAccessToken.mockReset()
  runQuery.mockReset().mockResolvedValue([{ id: 1, name: 'a' }])
})

describe('request shape', () => {
  it('always sends read_only: true and wraps with statement_timeout + row cap', async () => {
    await executeViaManagementApi(TARGET, 'select * from profiles', { maxRows: 100, timeoutMs: 5000 })
    const [token, ref, sql, opts] = runQuery.mock.calls[0]
    expect(token).toBe('tok-1')
    expect(ref).toBe('refabc')
    expect(opts).toEqual({ readOnly: true })
    expect(sql).toContain('set local statement_timeout = 5000')
    expect(sql).toContain('select * from (select * from profiles) as _supalens_q limit 101')
  })

  it('derives columns from row keys and detects truncation via the maxRows+1 probe', async () => {
    runQuery.mockResolvedValue([{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 6 }])
    const r = await executeViaManagementApi(TARGET, 'select a, b from t', { maxRows: 2 })
    expect(r.columns).toEqual(['a', 'b'])
    expect(r.rowCount).toBe(2)
    expect(r.truncated).toBe(true)
  })

  it('returns an empty result (no column metadata over this transport)', async () => {
    runQuery.mockResolvedValue([])
    const r = await executeViaManagementApi(TARGET, 'select 1 where false')
    expect(r).toMatchObject({ columns: [], rows: [], rowCount: 0, truncated: false })
  })
})

describe('guards run before any network call', () => {
  it('rejects non-SELECT SQL', async () => {
    await expect(executeViaManagementApi(TARGET, 'delete from users')).rejects.toThrow()
    expect(runQuery).not.toHaveBeenCalled()
    expect(getCachedAccessToken).not.toHaveBeenCalled()
  })

  it('rejects system-schema references (owner-level transport must not read vault/auth/…)', async () => {
    for (const sql of [
      'select * from vault.secrets',
      'select * from vault.decrypted_secrets',
      'select email from auth.users',
      'select * from "auth"."users"',
      'select query from extensions.pg_stat_statements',
      'select query from pg_stat_statements',
      'select * from storage.objects',
    ]) {
      await expect(executeViaManagementApi(TARGET, sql)).rejects.toThrow('protected system schema')
    }
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('does NOT false-positive on application tables that merely resemble system names', () => {
    expect(() => assertNoSystemSchemaRefs('select * from public.vaults')).not.toThrow()
    expect(() => assertNoSystemSchemaRefs('select author from public.posts')).not.toThrow()
    expect(() => assertNoSystemSchemaRefs('select * from user_auth_log')).not.toThrow()
  })
})

describe('error handling', () => {
  it('on 401: invalidates the cached token and retries exactly once', async () => {
    runQuery
      .mockRejectedValueOnce(new ManagementApiError('unauthorized', 401))
      .mockResolvedValueOnce([{ ok: true }])
    getCachedAccessToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')

    const r = await executeViaManagementApi(TARGET, 'select 1')
    expect(invalidateAccessToken).toHaveBeenCalledWith('conn-1')
    expect(runQuery).toHaveBeenCalledTimes(2)
    expect(r.rowCount).toBe(1)
  })

  it('maps 429 to a clear rate-limit error', async () => {
    runQuery.mockRejectedValue(new ManagementApiError('rate limited', 429, 30))
    await expect(executeViaManagementApi(TARGET, 'select 1')).rejects.toThrow('rate limit')
  })
})
