import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * resolveDataSource — the seam that decides WHICH database a tenant's query
 * connects to. Invariants under test:
 *   - deleted sources fail CLOSED (no secret is ever revealed for them)
 *   - the demo branch uses DEMO_DATABASE_URL and never touches the vault
 *   - the vault path pins the SSRF-validated IP (DNS-rebind defense) and keeps
 *     the original hostname for TLS SNI when the IP differs
 *   - a host that resolves private at CONNECT time propagates the failure
 *   - the credential cache reveals once per TTL and invalidateDataSource drops it
 */

const rows = new Map<string, Record<string, unknown>>()
const getCurrentSecret = vi.fn()
const revealSecret = vi.fn()
const resolveSafeHost = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          limit: async () => ({ data: rows.has(id) ? [rows.get(id)] : [], error: null }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/secrets/service', () => ({
  getCurrentSecret: (...a: unknown[]) => getCurrentSecret(...a),
  revealSecret: (...a: unknown[]) => revealSecret(...a),
}))
vi.mock('@/lib/data-sources/ssrf', () => ({
  resolveSafeHost: (...a: unknown[]) => resolveSafeHost(...a),
}))

import { resolveDataSource, invalidateDataSource } from './dsn'

let seq = 0
function seedRow(overrides: Record<string, unknown> = {}): string {
  const id = `ds-${++seq}`
  rows.set(id, {
    id,
    org_id: 'org-1',
    engine: 'postgres',
    status: 'active',
    deleted_at: null,
    is_demo: false,
    config: { host: 'db.tenant.example', port: 5432, database: 'appdb', db_user: 'supalens_ro', ssl: true },
    ...overrides,
  })
  return id
}

beforeEach(() => {
  rows.clear()
  getCurrentSecret.mockReset().mockResolvedValue({ id: 'sec-1', orgId: 'org-1', version: 1 })
  revealSecret.mockReset().mockResolvedValue('pw-plain')
  resolveSafeHost.mockReset().mockImplementation(async (host: string) => ({ ip: '203.0.113.9', original: host }))
  delete process.env.DEMO_DATABASE_URL
})

describe('fail-closed paths', () => {
  it('throws for a missing source', async () => {
    await expect(resolveDataSource('nope')).rejects.toThrow('not found')
  })

  it('throws for a soft-deleted source and never reveals its secret', async () => {
    const id = seedRow({ deleted_at: '2026-07-01T00:00:00Z' })
    await expect(resolveDataSource(id)).rejects.toThrow('deleted')
    expect(getCurrentSecret).not.toHaveBeenCalled()
    expect(revealSecret).not.toHaveBeenCalled()
  })

  it('propagates an SSRF failure at connect time (host now resolves private)', async () => {
    const id = seedRow()
    resolveSafeHost.mockRejectedValue(new Error('resolves to a private address'))
    await expect(resolveDataSource(id)).rejects.toThrow('private address')
  })

  it('throws when config is missing host or db_user', async () => {
    const id = seedRow({ config: { database: 'appdb' } })
    await expect(resolveDataSource(id)).rejects.toThrow('missing host/db_user')
  })
})

describe('demo branch', () => {
  it('uses DEMO_DATABASE_URL and never touches the vault or SSRF pin', async () => {
    process.env.DEMO_DATABASE_URL = 'postgres://demo_ro:s3cret%21@demo.neon.example:5433/demodb'
    const id = seedRow({ is_demo: true, config: null })
    const r = await resolveDataSource(id)
    expect(r.cfg).toMatchObject({
      engine: 'postgres',
      host: 'demo.neon.example',
      port: 5433,
      database: 'demodb',
      user: 'demo_ro',
      password: 's3cret!',
      ssl: true,
    })
    expect(getCurrentSecret).not.toHaveBeenCalled()
    expect(resolveSafeHost).not.toHaveBeenCalled()
  })

  it('honors sslmode=disable and throws without the env var', async () => {
    process.env.DEMO_DATABASE_URL = 'postgres://u:p@h:5432/d?sslmode=disable'
    const withSsl = seedRow({ is_demo: true })
    expect((await resolveDataSource(withSsl)).cfg!.ssl).toBe(false)

    delete process.env.DEMO_DATABASE_URL
    const noEnv = seedRow({ is_demo: true })
    await expect(resolveDataSource(noEnv)).rejects.toThrow('DEMO_DATABASE_URL')
  })
})

describe('vault path + DNS-rebind pin', () => {
  it('connects to the PINNED ip, keeping the hostname as TLS servername when rebound', async () => {
    const id = seedRow()
    const r = await resolveDataSource(id)
    expect(revealSecret).toHaveBeenCalledTimes(1)
    expect(r.orgId).toBe('org-1')
    expect(r.cfg!.host).toBe('203.0.113.9') // pinned IP, not the hostname
    expect(r.cfg!.servername).toBe('db.tenant.example')
    expect(r.cfg!.password).toBe('pw-plain')
  })

  it('omits servername when the "host" was already a literal IP (no rebind)', async () => {
    resolveSafeHost.mockResolvedValue({ ip: '203.0.113.9', original: '203.0.113.9' })
    const id = seedRow({ config: { host: '203.0.113.9', db_user: 'supalens_ro' } })
    const r = await resolveDataSource(id)
    expect(r.cfg!.servername).toBeUndefined()
  })

  it("preserves the 'require' TLS mode (Boolean() upgraded it to full verify, which provider-CA poolers fail)", async () => {
    const id = seedRow({ config: { host: 'db.tenant.example', db_user: 'ro', ssl: 'require' } })
    const r = await resolveDataSource(id)
    expect(r.cfg!.ssl).toBe('require')

    const bool = seedRow({ config: { host: 'db.tenant.example', db_user: 'ro', ssl: true } })
    expect((await resolveDataSource(bool)).cfg!.ssl).toBe(true)
  })

  it('prefers pooler_host/pooler_port over host/port', async () => {
    const id = seedRow({
      config: { host: 'direct.example', port: 5432, pooler_host: 'pooler.example', pooler_port: 6543, db_user: 'ro' },
    })
    await resolveDataSource(id)
    expect(resolveSafeHost).toHaveBeenCalledWith('pooler.example')
    const r = await resolveDataSource(id)
    expect(r.cfg!.port).toBe(6543)
  })

  it('routes a Supabase-OAuth source to the Management-API transport — no vault reveal, no SSRF pin', async () => {
    const id = seedRow({
      provider: 'supabase',
      connection_id: 'conn-1',
      config: { project_ref: 'refabc', pooler_host: 'aws-1.pooler.supabase.com', db_user: 'supalens_ro.refabc' },
    })
    const r = await resolveDataSource(id)
    expect(r.supabaseApi).toEqual({ connectionId: 'conn-1', projectRef: 'refabc' })
    expect(r.cfg).toBeUndefined()
    expect(r.orgId).toBe('org-1')
    expect(getCurrentSecret).not.toHaveBeenCalled()
    expect(revealSecret).not.toHaveBeenCalled()
    expect(resolveSafeHost).not.toHaveBeenCalled()
  })

  it('falls back to the pooler when a supabase source has no project_ref (legacy safety)', async () => {
    const id = seedRow({ provider: 'supabase', connection_id: 'conn-1' }) // default config: host + db_user, no ref
    const r = await resolveDataSource(id)
    expect(r.supabaseApi).toBeUndefined()
    expect(r.cfg!.host).toBe('203.0.113.9')
    expect(revealSecret).toHaveBeenCalledTimes(1)
  })

  it('keeps the demo source on the pool transport even if provider says supabase', async () => {
    process.env.DEMO_DATABASE_URL = 'postgres://u:p@h:5432/d'
    const id = seedRow({ is_demo: true, provider: 'supabase', connection_id: 'conn-1', config: { project_ref: 'x' } })
    const r = await resolveDataSource(id)
    expect(r.supabaseApi).toBeUndefined()
    expect(r.cfg!.host).toBe('h')
  })

  it('caches within the TTL (one reveal) and invalidateDataSource forces re-resolve', async () => {
    const id = seedRow()
    await resolveDataSource(id)
    await resolveDataSource(id)
    expect(revealSecret).toHaveBeenCalledTimes(1)

    invalidateDataSource(id)
    await resolveDataSource(id)
    expect(revealSecret).toHaveBeenCalledTimes(2)
  })
})
