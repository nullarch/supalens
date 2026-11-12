import { describe, expect, it, vi } from 'vitest'
import { loadRoute } from './route-harness.test-helper'

type MetadataResult = { data: Array<{ metadata: unknown }> | null; error?: unknown }
type Scope = { channels: Array<{ id: string; name: string }>; selected: string[]; unavailable: boolean }
type View = { type: string; props: { orgId: string; conns: unknown; sources: unknown; repos: unknown; params: unknown; slackScopes: Record<string, Scope>; canManage: boolean; canAnalyze: boolean; slackReady: boolean } }

function fixture(options: { role?: string; signedIn?: boolean; configured?: boolean; result?: MetadataResult; token?: string | null; channelFailure?: boolean; noClient?: boolean } = {}) {
  const role = options.role ?? 'owner'
  const conns = [
    { id: 'slack-a', provider: 'slack', status: 'active' },
    { id: 'slack-b', provider: 'slack', status: 'active' },
    { id: 'slack-revoked', provider: 'slack', status: 'revoked' },
    { id: 'github-a', provider: 'github', status: 'active' },
  ]
  const sources = [{ id: 'source-a' }], repos = [{ id: 'repo-a' }]
  const filters: unknown[][] = []
  const client = { auth: { getUser: async () => ({ data: { user: options.signedIn === false ? null : { id: 'user-a' } } }) } }
  const ensureOrg = vi.fn(async () => 'org-a')
  const roleCheck = vi.fn(async (_client: unknown, _org: string, _user: string, roles = ['owner', 'admin']) => roles.includes(role))
  const loadRows = vi.fn(async () => ({ conns, sources, repos }))
  const admin = vi.fn(() => ({ from: (table: string) => {
    const queryFilters: unknown[][] = [['from', table]]
    let connection = ''
    const query = {
      select: (columns: string) => { queryFilters.push(['select', columns]); return query },
      eq: (key: string, value: string) => { queryFilters.push(['eq', key, value]); if (key === 'id') connection = value; return query },
      is: (key: string, value: null) => { queryFilters.push(['is', key, value]); return query },
      limit: async (count: number) => {
        filters.push([...queryFilters, ['limit', count]])
        return options.result ?? { data: [{ metadata: { allowed_channel_ids: [`channel-${connection}`] } }] }
      },
    }
    return query
  } }))
  const token = vi.fn(async (id: string) => options.token === undefined ? `local-token-${id}` : options.token)
  const channels = vi.fn(async (value: string) => {
    if (options.channelFailure) throw new Error('local provider failure')
    return [{ id: value.replace('local-token-', 'channel-'), name: value.replace('local-token-', '') }]
  })
  const page = loadRoute('app/settings/integrations/page.tsx', {
    'next/navigation': { redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) } },
    'next-intl/server': { getTranslations: async () => (key: string) => key },
    '@/utils/supabase/server': { createClient: async () => options.noClient ? null : client },
    '@/utils/supabase/admin': { requireAdminClient: admin },
    '@/lib/slack-app/config': { slackConfigured: () => options.configured !== false },
    '@/lib/slack-app/token': { botTokenForConnection: token },
    '@/lib/slack-app/client': { listConversations: channels },
    '@/lib/org/server': { ensurePrimaryOrg: ensureOrg },
    '@/lib/org/require-role': { userHasOrgRole: roleCheck },
    './settings-data': { loadIntegrationRows: loadRows },
    './IntegrationsView': { IntegrationsView: 'IntegrationsView' },
    './integrations.module.css': { page: 'integration-page' },
  })
  const params = { connected: 'slack', team: 'Example team', error: 'sample-return' }
  const render = async () => await page.default({ searchParams: Promise.resolve(params) }) as View
  return { render, params, client, conns, sources, repos, ensureOrg, roleCheck, loadRows, admin, token, channels, filters }
}

describe('actual integration route → redesigned view, mocked local IO only', () => {
  for (const role of ['owner', 'admin', 'member', 'viewer']) {
    it(`preserves org, records, query params and role-specific server access (${role})`, async () => {
      const f = fixture({ role }), view = await f.render()
      const canManage = ['owner', 'admin'].includes(role)
      expect(view.type).toBe('IntegrationsView')
      expect(view.props).toMatchObject({ orgId: 'org-a', canManage, canAnalyze: role !== 'viewer', slackReady: true })
      for (const key of ['conns', 'sources', 'repos', 'params'] as const) expect(view.props[key]).toBe(f[key])
      expect(f.loadRows).toHaveBeenCalledExactlyOnceWith(f.client, 'org-a')
      expect(f.roleCheck).toHaveBeenNthCalledWith(1, f.client, 'org-a', 'user-a')
      expect(f.roleCheck).toHaveBeenNthCalledWith(2, f.client, 'org-a', 'user-a', ['owner', 'admin', 'member'])
      expect(f.admin).toHaveBeenCalledTimes(canManage ? 2 : 0)
      expect(f.token).toHaveBeenCalledTimes(canManage ? 2 : 0)
      if (!canManage) expect(view.props.slackScopes).toEqual({})
      else {
        expect(view.props.slackScopes).toEqual({
          'slack-a': { channels: [{ id: 'channel-slack-a', name: 'slack-a' }], selected: ['channel-slack-a'], unavailable: false },
          'slack-b': { channels: [{ id: 'channel-slack-b', name: 'slack-b' }], selected: ['channel-slack-b'], unavailable: false },
          'slack-revoked': { channels: [], selected: [], unavailable: true },
        })
        for (const [index, id] of ['slack-a', 'slack-b'].entries()) expect(f.filters[index]).toEqual([
          ['from', 'provider_connections'], ['select', 'metadata'], ['eq', 'id', id], ['eq', 'org_id', 'org-a'],
          ['eq', 'provider', 'slack'], ['eq', 'status', 'active'], ['is', 'deleted_at', null], ['limit', 1],
        ])
        expect(JSON.stringify(view.props)).not.toContain('local-token-')
      }
    })
  }
  for (const [name, result] of Object.entries<MetadataResult>({
    'failed metadata': { data: null, error: { message: 'sample read error' } },
    'missing metadata row': { data: [] },
    'non-array scope': { data: [{ metadata: { allowed_channel_ids: 'channel-a' } }] },
    'non-string channel': { data: [{ metadata: { allowed_channel_ids: [12] } }] },
  })) {
    it(`${name} remains unavailable, without loading a token or exposing unrestricted scope`, async () => {
      const f = fixture({ result }), view = await f.render()
      expect(view.props.slackScopes['slack-a']).toEqual({ channels: [], selected: [], unavailable: true })
      expect(f.token).not.toHaveBeenCalled()
      expect(f.channels).not.toHaveBeenCalled()
    })
  }
  for (const options of [{ token: null }, { channelFailure: true }]) {
    it(`missing token or failed channel listing remains unavailable (${JSON.stringify(options)})`, async () => {
      const f = fixture(options), view = await f.render()
      expect(view.props.slackScopes['slack-a']).toEqual({ channels: [], selected: [], unavailable: true })
    })
  }
  it('retains recorded connections when app-level Slack configuration is absent', async () => {
    const f = fixture({ configured: false }), view = await f.render()
    expect(view.props.slackReady).toBe(false)
    expect(view.props.conns).toBe(f.conns)
  })
  it('redirects anonymous users before any organization, metadata or provider access', async () => {
    const f = fixture({ signedIn: false })
    await expect(f.render()).rejects.toThrow('REDIRECT:/login?next=/app/settings/integrations')
    for (const fn of [f.ensureOrg, f.roleCheck, f.loadRows, f.admin, f.token, f.channels]) expect(fn).not.toHaveBeenCalled()
  })
  it('shows the configuration fallback without accessing organization/provider data', async () => {
    const f = fixture({ noClient: true }), view = await f.render()
    expect(view.type).toBe('main')
    expect(view.props).toMatchObject({ children: 'page.notConfigured' })
    for (const fn of [f.ensureOrg, f.roleCheck, f.loadRows, f.admin, f.token, f.channels]) expect(fn).not.toHaveBeenCalled()
  })
})
