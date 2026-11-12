import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), admin: vi.fn(), role: vi.fn(), org: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/utils/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: mocks.admin }))
vi.mock('@/lib/org/server', () => ({ ensurePrimaryOrg: mocks.org }))
vi.mock('@/lib/org/require-role', () => ({ userHasOrgRole: mocks.role, orgOfConnection: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/supabase-oauth/disconnect', () => ({ disconnectSupabase: vi.fn() }))
vi.mock('@/lib/supabase-oauth/connect', () => ({ resyncSupabaseProjects: vi.fn() }))
vi.mock('@/lib/github-app/disconnect', () => ({ disconnectGithub: vi.fn() }))
vi.mock('@/lib/slack-app/disconnect', () => ({ disconnectSlack: vi.fn() }))
vi.mock('@/lib/supabase-oauth/tokens', () => ({ isReconnectRequired: vi.fn() }))
import { setSlackAllowedChannelsAction, toggleRepoAnalysisAction } from './actions'

type Result = { data: unknown; error: unknown }
let results: Result[] = []
const queries: Array<unknown[][]> = []
const client = { auth: { getUser: vi.fn() }, from: vi.fn(from) }
function from() {
  const steps: unknown[][] = []; queries.push(steps)
  const add = (name: string, args: unknown[]) => { steps.push([name, ...args]); return builder }
  const builder = {
    select: (...args: unknown[]) => add('select', args), update: (...args: unknown[]) => add('update', args),
    eq: (...args: unknown[]) => add('eq', args), is: (...args: unknown[]) => add('is', args), limit: (...args: unknown[]) => add('limit', args),
    then: (resolve: (value: Result) => unknown) => {
      const result = results.shift()
      if (!result) throw new Error('Unexpected mock query')
      return Promise.resolve(result).then(resolve)
    },
  }; return builder
}
const existing = { data: [{ id: 'selected-connection', metadata: { preserved: 'value', allowed_channel_ids: ['old'] } }], error: null }
beforeEach(() => {
  vi.clearAllMocks(); results = []; queries.length = 0
  client.auth.getUser.mockResolvedValue({ data: { user: { id: 'sample-user' } } })
  mocks.createClient.mockResolvedValue(client); mocks.admin.mockReturnValue({ from })
  mocks.org.mockResolvedValue('selected-org'); mocks.role.mockResolvedValue(true)
})
describe('Slack mention scope persistence', () => {
  for (const values of [[' C1 ', 'C1', 'C2', ''], []]) it(`preserves metadata and pins the connection when saving ${values.length} inputs`, async () => {
    results = [existing, { data: [{ id: 'selected-connection' }], error: null }]
    await expect(setSlackAllowedChannelsAction(values, 'selected-connection')).resolves.toEqual({ ok: true })
    expect(queries).toHaveLength(2)
    for (const query of queries) {
      for (const filter of [['org_id', 'selected-org'], ['id', 'selected-connection'], ['provider', 'slack'], ['status', 'active']]) expect(query).toContainEqual(['eq', ...filter])
      expect(query).toContainEqual(['is', 'deleted_at', null])
    }
    expect(queries[1][0]).toEqual(['update', { metadata: { preserved: 'value', allowed_channel_ids: values.length ? ['C1', 'C2'] : [] } }])
    expect(mocks.revalidate).toHaveBeenCalledWith('/app/settings/integrations')
  })
  for (const result of [{ data: null, error: { message: 'private detail' } }, { data: null, error: null }]) it('does not interpret a failed read as an unrestricted channel list', async () => {
    results = [result]
    await expect(setSlackAllowedChannelsAction([], 'selected-connection')).resolves.toEqual({ ok: false, message: 'page.slackScope.saveFailed' })
    expect(queries).toHaveLength(1); expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  for (const result of [{ data: null, error: { message: 'private detail' } }, { data: [], error: null }]) it('requires a successful affected row without leaking raw database text', async () => {
    results = [existing, result]
    await expect(setSlackAllowedChannelsAction(['C1'], 'selected-connection')).resolves.toEqual({ ok: false, message: 'page.slackScope.saveFailed' })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('denies insufficient roles before service-role access', async () => {
    mocks.role.mockResolvedValue(false)
    await expect(setSlackAllowedChannelsAction([])).resolves.toMatchObject({ ok: false, message: 'page.slackScope.noPermission' })
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('keeps a connection outside the scoped lookup unavailable', async () => {
    results = [{ data: [], error: null }]
    await expect(setSlackAllowedChannelsAction([], 'other-connection')).resolves.toMatchObject({ ok: false, message: 'page.slackScope.notConnected' })
    expect(queries).toHaveLength(1); expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe('repository auto-analysis persistence acknowledgement', () => {
  const input = (enabled = 'false', repoId = 'sample-repo') => {
    const data = new FormData(); data.set('repoId', repoId); data.set('enabled', enabled); return data
  }
  for (const enabled of [true, false]) it(`acknowledges the affected row when setting ${enabled}`, async () => {
    results = [{ data: [{ id: 'sample-repo', analysis_enabled: enabled }], error: null }]
    await expect(toggleRepoAnalysisAction(input(String(enabled)))).resolves.toEqual({ ok: true })
    expect(client.from).toHaveBeenCalledWith('github_repositories')
    expect(queries[0]).toEqual([
      ['update', { analysis_enabled: enabled }], ['eq', 'id', 'sample-repo'],
      ['is', 'deleted_at', null], ['select', 'id, analysis_enabled'],
    ])
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith('/app/settings/integrations')
  })
  for (const result of [
    { data: null, error: { message: 'private database error' } }, { data: null, error: null },
    { data: [], error: null }, { data: {}, error: null },
    { data: [{ id: 'different-repo', analysis_enabled: false }], error: null },
    { data: [{ id: 'sample-repo', analysis_enabled: true }], error: null },
  ]) it('does not confirm failed, invisible or mismatched writes', async () => {
    results = [result]
    await expect(toggleRepoAnalysisAction(input())).resolves.toEqual({ ok: false })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  for (const [value, id] of [['yes', 'sample-repo'], ['false', ' ']]) it('rejects malformed input before access', async () => {
    await expect(toggleRepoAnalysisAction(input(value, id))).resolves.toEqual({ ok: false })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it('authenticates before updating through the user client', async () => {
    client.auth.getUser.mockResolvedValue({ data: { user: null } })
    await expect(toggleRepoAnalysisAction(input())).rejects.toThrow('unauthorized')
    expect(queries).toHaveLength(0)
  })
})
