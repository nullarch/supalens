import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * bootstrapConnectionProjects — the provisioning seam for Supabase-OAuth sources.
 * Invariants under test (extracted from a real prod incident: getPoolerConfigs used to
 * misparse the API's array response, so every OAuth source went 'active' with
 * `pooler_host: null` and failed every query with "missing host/db_user"):
 *   - a source without a pooler host is NEVER left connectable-looking — it fails closed
 *     to status 'error' / last_error_code 'pooler_config_unavailable', and no role is minted
 *   - a re-run REFRESHES the stored config of an existing row (the heal path for the
 *     incident rows) without re-minting an active row's credentials
 *   - a transient pooler-fetch failure never clobbers a working stored config or
 *     downgrades a working row
 *   - a reused pending/error row still gets (re)minted (partial-bootstrap heal)
 */

type Row = Record<string, unknown>

const dsPrior: Row[] = [] // pre-seeded existing data_sources rows (the upsert's prior lookup)
const dsUpdates: Array<{ id: string; payload: Row }> = []
const dsInserts: Row[] = []

const fetchPoolerConfig = vi.fn()
const mintReadonlyRole = vi.fn()
const putSecret = vi.fn()
const listProjects = vi.fn()

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))
vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: (table: string) => ({
      update: (payload: Row) => ({
        eq: async (_col: string, id: string) => {
          if (table === 'data_sources') dsUpdates.push({ id, payload })
          return { error: null }
        },
      }),
      select: () => ({
        eq: () => ({
          eq: (_col: string, ref: string) => ({
            is: () => ({
              limit: async () => ({
                data: dsPrior.filter((r) => (r.config as Row | null)?.project_ref === ref),
                error: null,
              }),
            }),
          }),
        }),
      }),
      insert: (row: Row) => ({
        select: async () => {
          dsInserts.push(row)
          return { data: [{ id: `ds-new-${dsInserts.length}` }], error: null }
        },
      }),
    }),
  }),
}))
vi.mock('@/lib/secrets/service', () => ({
  putSecret: (...a: unknown[]) => putSecret(...a),
}))
vi.mock('@/lib/supabase-oauth/tokens', () => ({
  getValidAccessToken: async () => ({ accessToken: 'tok' }),
}))
vi.mock('@/lib/supabase-management/client', () => ({
  SupabaseManagementClient: class {
    listOrganizations = async () => []
    listProjects = () => listProjects()
  },
}))
vi.mock('@/lib/supabase-management/bootstrap', () => ({
  READONLY_ROLE: 'supalens_ro',
  fetchPoolerConfig: (...a: unknown[]) => fetchPoolerConfig(...a),
  mintReadonlyRole: (...a: unknown[]) => mintReadonlyRole(...a),
}))

const sendDataConnectedToHub = vi.fn()
vi.mock('@/lib/event-hub/events', () => ({
  sendDataConnectedToHub: (...a: unknown[]) => sendDataConnectedToHub(...a),
}))

import { bootstrapConnectionProjects } from './bootstrap-projects'

const ARGS = { orgId: 'org-1', userId: 'user-1', connectionId: 'conn-1', accessToken: 'tok' }
const PROJECT = { id: 'refabc', organization_id: 'sbo', name: 'shineai-app', region: 'ap-northeast-2', status: 'ACTIVE_HEALTHY' }
const POOLER = { db_host: 'aws-1-ap.pooler.supabase.com', db_port: 6543, db_name: 'postgres', pool_mode: 'transaction' }

function updatesFor(id: string): Row[] {
  return dsUpdates.filter((u) => u.id === id).map((u) => u.payload)
}

beforeEach(() => {
  dsPrior.length = 0
  dsUpdates.length = 0
  dsInserts.length = 0
  sendDataConnectedToHub.mockClear()
  fetchPoolerConfig.mockReset().mockResolvedValue(POOLER)
  mintReadonlyRole.mockReset().mockResolvedValue('minted-pw')
  putSecret.mockReset().mockResolvedValue('sec-1')
  listProjects.mockReset().mockResolvedValue([PROJECT])
})

describe('fresh project', () => {
  it('stores the pooler host, mints, and activates (clearing any stale error code)', async () => {
    const res = await bootstrapConnectionProjects(ARGS)

    expect(res.dataSourceCount).toBe(1)
    expect(dsInserts[0].config).toMatchObject({
      project_ref: 'refabc',
      pooler_host: 'aws-1-ap.pooler.supabase.com',
      pooler_port: 6543,
      db_user: 'supalens_ro.refabc',
    })
    expect(mintReadonlyRole).toHaveBeenCalledTimes(1)
    expect(putSecret).toHaveBeenCalledWith(expect.objectContaining({ parent: { dataSourceId: 'ds-new-1' } }))
    expect(updatesFor('ds-new-1')).toContainEqual(
      expect.objectContaining({ status: 'active', last_error_code: null })
    )
  })

  it('fails CLOSED when no pooler host is available: error row, no mint, no secret', async () => {
    fetchPoolerConfig.mockResolvedValue(null)
    const res = await bootstrapConnectionProjects(ARGS)

    expect(res.dataSourceCount).toBe(0)
    expect(updatesFor('ds-new-1')).toContainEqual({ status: 'error', last_error_code: 'pooler_config_unavailable' })
    expect(mintReadonlyRole).not.toHaveBeenCalled()
    expect(putSecret).not.toHaveBeenCalled()
  })
})

describe('re-run over an existing row (resync/heal)', () => {
  it('refreshes a broken host-less ACTIVE row\'s config without re-minting its credentials', async () => {
    dsPrior.push({
      id: 'ds-broken',
      status: 'active',
      config: { project_ref: 'refabc', pooler_host: null, db_user: 'supalens_ro.refabc' },
    })
    const res = await bootstrapConnectionProjects(ARGS)

    expect(res.dataSourceCount).toBe(1)
    const configUpdate = updatesFor('ds-broken').find((p) => 'config' in p)
    expect((configUpdate?.config as Row).pooler_host).toBe('aws-1-ap.pooler.supabase.com')
    expect(mintReadonlyRole).not.toHaveBeenCalled() // active row: stored password keeps working
    expect(dsInserts).toHaveLength(0) // reused, not duplicated
  })

  it('never clobbers a working config or downgrades a working row on a transient fetch failure', async () => {
    dsPrior.push({
      id: 'ds-ok',
      status: 'active',
      config: { project_ref: 'refabc', pooler_host: 'aws-1-ap.pooler.supabase.com' },
    })
    fetchPoolerConfig.mockResolvedValue(null)
    const res = await bootstrapConnectionProjects(ARGS)

    expect(res.dataSourceCount).toBe(1)
    expect(updatesFor('ds-ok')).toHaveLength(0)
    expect(mintReadonlyRole).not.toHaveBeenCalled()
  })

  it('re-mints on a reused error row (partial-bootstrap heal) and reactivates it', async () => {
    dsPrior.push({
      id: 'ds-err',
      status: 'error',
      config: { project_ref: 'refabc', pooler_host: 'aws-1-ap.pooler.supabase.com' },
    })
    const res = await bootstrapConnectionProjects(ARGS)

    expect(res.dataSourceCount).toBe(1)
    expect(mintReadonlyRole).toHaveBeenCalledTimes(1)
    expect(putSecret).toHaveBeenCalledWith(expect.objectContaining({ parent: { dataSourceId: 'ds-err' } }))
    expect(updatesFor('ds-err')).toContainEqual(
      expect.objectContaining({ status: 'active', last_error_code: null })
    )
  })

  it('downgrades a host-less ACTIVE row to error when the fetch also fails (visible, not silently broken)', async () => {
    dsPrior.push({
      id: 'ds-broken',
      status: 'active',
      config: { project_ref: 'refabc', pooler_host: null },
    })
    fetchPoolerConfig.mockResolvedValue(null)
    const res = await bootstrapConnectionProjects(ARGS)

    expect(res.dataSourceCount).toBe(0)
    expect(updatesFor('ds-broken')).toContainEqual({ status: 'error', last_error_code: 'pooler_config_unavailable' })
    expect(mintReadonlyRole).not.toHaveBeenCalled()
  })
})

describe('data_connected', () => {
  it('fires for the acting user once the source is active', async () => {
    await bootstrapConnectionProjects(ARGS)
    expect(sendDataConnectedToHub).toHaveBeenCalledWith(expect.anything(), 'user-1', 'ds-new-1')
  })

  it('stays silent when provisioning fails or the source was already active', async () => {
    mintReadonlyRole.mockRejectedValue(new Error('no'))
    await bootstrapConnectionProjects(ARGS)
    fetchPoolerConfig.mockResolvedValue(null)
    await bootstrapConnectionProjects(ARGS)
    dsPrior.push({ id: 'ds-ok', status: 'active', config: { project_ref: 'refabc', pooler_host: 'h' } })
    fetchPoolerConfig.mockResolvedValue(POOLER)
    await bootstrapConnectionProjects(ARGS)
    expect(sendDataConnectedToHub).not.toHaveBeenCalled()
  })
})
