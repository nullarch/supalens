import { describe, expect, it } from 'vitest'

import {
  SYSTEM_SCHEMAS,
  dropReadonlyRole,
  fetchPoolerConfig,
  generateRolePassword,
  hardenReadonlyRole,
  mintReadonlyRole,
} from './bootstrap'

/**
 * Pins the read-only role SQL invariants proven empirically against local Postgres
 * (see memory: supalens_ro system-schema exposure):
 *  - `pg_read_all_data` is NOT BYPASSRLS and, worse, grants implicit reach into system
 *    schemas (vault/pgsodium/extensions/net/auth) that REVOKE cannot carve out — so the
 *    role must be granted per-USER-schema instead.
 *  - the explicit grants make supalens_ro a dependency of many objects, so teardown must
 *    use `drop owned by` (bare `drop role` fails).
 */

/** Stub Management client that captures the SQL instead of calling the API. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function captureSql(run: (client: any) => Promise<unknown>): Promise<string> {
  let sql = ''
  const client = { runQuery: async (_ref: string, s: string) => void (sql = s) }
  return run(client).then(() => sql)
}

describe('mintReadonlyRole SQL', () => {
  it('does NOT grant pg_read_all_data (it exposes system schemas)', async () => {
    const sql = await captureSql((c) => mintReadonlyRole(c, 'ref'))
    expect(sql).not.toMatch(/pg_read_all_data/)
  })

  it('grants SELECT per user schema, excluding system schemas + pg_* ', async () => {
    const sql = await captureSql((c) => mintReadonlyRole(c, 'ref'))
    expect(sql).toMatch(/grant usage on schema %I to supalens_ro/)
    expect(sql).toMatch(/grant select on all tables in schema %I to supalens_ro/)
    // future tables in existing schemas stay covered
    expect(sql).toMatch(/alter default privileges in schema %I grant select on tables/)
    // pg_catalog / pg_toast / pg_temp_* excluded via a LIKE guard
    expect(sql).toMatch(/nspname not like 'pg\\_%'/)
  })

  it('excludes every sensitive system schema from the grant set', async () => {
    const sql = await captureSql((c) => mintReadonlyRole(c, 'ref'))
    for (const s of ['auth', 'vault', 'pgsodium', 'extensions', 'net', 'storage']) {
      expect(SYSTEM_SCHEMAS).toContain(s)
      expect(sql).toContain(`'${s}'`)
    }
  })

  it('keeps the read-only + statement_timeout hardening', async () => {
    const sql = await captureSql((c) => mintReadonlyRole(c, 'ref'))
    expect(sql).toMatch(/default_transaction_read_only = on/)
    expect(sql).toMatch(/statement_timeout = '30s'/)
    expect(sql).toMatch(/create role supalens_ro with login password/)
  })
})

describe('hardenReadonlyRole SQL (backfill / re-grant)', () => {
  it('revokes a legacy pg_read_all_data grant without touching the password', async () => {
    const sql = await captureSql((c) => hardenReadonlyRole(c, 'ref'))
    expect(sql).toMatch(/revoke pg_read_all_data from supalens_ro/)
    expect(sql).not.toMatch(/login password/) // never rotates stored creds
    expect(sql).not.toMatch(/create role/)
  })

  it('re-runs the user-schema grant loop (covers newly-created schemas)', async () => {
    const sql = await captureSql((c) => hardenReadonlyRole(c, 'ref'))
    expect(sql).toMatch(/grant usage on schema %I to supalens_ro/)
  })
})

describe('dropReadonlyRole SQL', () => {
  it('uses drop owned by (bare drop role fails on the dependent grants)', async () => {
    const sql = await captureSql((c) => dropReadonlyRole(c, 'ref'))
    expect(sql).toMatch(/grant supalens_ro to %I/) // membership so DROP OWNED BY is permitted
    expect(sql).toMatch(/drop owned by supalens_ro/)
    expect(sql).toMatch(/drop role supalens_ro/)
  })
})

describe('fetchPoolerConfig (the Management API returns an ARRAY)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mgmtWith = (res: unknown) => ({ getPoolerConfigs: async () => res }) as any

  it('picks the PRIMARY entry, never a read replica', async () => {
    const cfg = await fetchPoolerConfig(
      mgmtWith([
        { database_type: 'READ_REPLICA', db_host: 'replica.pooler.supabase.com', db_port: 6543 },
        { database_type: 'PRIMARY', db_host: 'aws-1-ap.pooler.supabase.com', db_port: 6543 },
      ]),
      'ref'
    )
    expect(cfg?.db_host).toBe('aws-1-ap.pooler.supabase.com')
  })

  it('falls back to the first entry when nothing is marked PRIMARY', async () => {
    const cfg = await fetchPoolerConfig(mgmtWith([{ db_host: 'only.pooler.supabase.com' }]), 'ref')
    expect(cfg?.db_host).toBe('only.pooler.supabase.com')
  })

  it('tolerates a bare-object response (defensive against API shape changes)', async () => {
    const cfg = await fetchPoolerConfig(mgmtWith({ db_host: 'obj.pooler.supabase.com' }), 'ref')
    expect(cfg?.db_host).toBe('obj.pooler.supabase.com')
  })

  it('returns null on an empty array or an API failure (best-effort contract)', async () => {
    expect(await fetchPoolerConfig(mgmtWith([]), 'ref')).toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const throwing = { getPoolerConfigs: async () => Promise.reject(new Error('403')) } as any
    expect(await fetchPoolerConfig(throwing, 'ref')).toBeNull()
  })
})

describe('generateRolePassword', () => {
  it('is SQL-literal safe (base64url only) and long', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateRolePassword()
      expect(pw).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(pw.length).toBeGreaterThanOrEqual(40)
    }
  })
})
