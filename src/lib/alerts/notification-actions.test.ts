import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), requireAdminClient: vi.fn(), ensurePrimaryOrg: vi.fn(),
  userHasOrgRole: vi.fn(), revalidatePath: vi.fn(), trackServer: vi.fn(),
}))
vi.mock('@/utils/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: mocks.requireAdminClient }))
vi.mock('@/lib/org/server', () => ({ ensurePrimaryOrg: mocks.ensurePrimaryOrg }))
vi.mock('@/lib/org/require-role', () => ({ userHasOrgRole: mocks.userHasOrgRole }))
vi.mock('@/lib/analytics/server', () => ({ trackServer: mocks.trackServer }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en', getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}` }))
vi.mock('@/lib/query', () => ({ assertReadOnly: vi.fn(), UnsafeSqlError: class extends Error {} }))
vi.mock('@/lib/plans/usage', () => ({ enforceResourceLimit: vi.fn() }))
vi.mock('@/lib/data-sources/engines', () => ({ isSqlEngine: vi.fn() }))

import { setAlertSlackChannel, setDiscordWebhook, setSlackWebhook } from './actions'

type Result = { data: unknown; error: unknown }
type Step = { method: string; args: unknown[] }
type Query = { table: string; steps: Step[] }
const queries: Query[] = []
let responses: Array<Result | Error> = []
const ok = (data: unknown = null): Result => ({ data, error: null })
const failure = { data: null, error: { code: '42501', message: 'database detail with PRIVATE_POSTING_CREDENTIAL' } }
const safeFailure = { ok: false, reason: 'error', message: 'alertActions.notificationSaveFailed' }

/** Awaitable PostgREST builder: every read/write must consume one explicit local response. */
function from(table: string) {
  const query: Query = { table, steps: [] }
  queries.push(query)
  const step = (method: string, args: unknown[]) => { query.steps.push({ method, args }); return builder }
  const builder = {
    select: (...args: unknown[]) => step('select', args),
    delete: (...args: unknown[]) => step('delete', args),
    update: (...args: unknown[]) => step('update', args),
    insert: (...args: unknown[]) => step('insert', args),
    upsert: (...args: unknown[]) => step('upsert', args),
    eq: (...args: unknown[]) => step('eq', args),
    is: (...args: unknown[]) => step('is', args),
    limit: (...args: unknown[]) => step('limit', args),
    then: (resolve: (value: Result) => unknown, reject?: (error: Error) => unknown) => {
      const response = responses.shift()
      return (response instanceof Error ? Promise.reject(response)
        : response ? Promise.resolve(response) : Promise.reject(new Error('Unexpected persistence request'))).then(resolve, reject)
    },
  }
  return builder
}

const client = { auth: { getUser: vi.fn() } }
const existing = ok([{ id: 'sample-channel-row' }])
const connection = ok([{ id: 'sample-connection' }])
const cases = [
  { name: 'remove Slack webhook', run: () => setSlackWebhook('  '), before: [], table: 'org_slack_config', method: 'delete', clear: true },
  { name: 'save Slack webhook', run: () => setSlackWebhook(' https://hooks.slack.com/services/SAMPLE_ONLY '), before: [], table: 'org_slack_config', method: 'upsert', clear: false },
  { name: 'disable Discord', run: () => setDiscordWebhook(''), before: [], table: 'notification_channels', method: 'update', clear: true, provider: 'discord' },
  { name: 'create Discord', run: () => setDiscordWebhook('https://discord.com/api/webhooks/SAMPLE_ONLY'), before: [ok([])], table: 'notification_channels', method: 'insert', clear: false, provider: 'discord' },
  { name: 'update Discord', run: () => setDiscordWebhook('https://discord.com/api/webhooks/SAMPLE_ONLY'), before: [existing], table: 'notification_channels', method: 'update', clear: false, provider: 'discord' },
  { name: 'disable Slack bot', run: () => setAlertSlackChannel('', ''), before: [], table: 'notification_channels', method: 'update', clear: true, provider: 'slack' },
  { name: 'create Slack bot channel', run: () => setAlertSlackChannel(' sample-channel ', ' sample-label '), before: [connection, ok([])], table: 'notification_channels', method: 'insert', clear: false, provider: 'slack' },
  { name: 'update Slack bot channel', run: () => setAlertSlackChannel(' sample-channel ', ' sample-label '), before: [connection, existing], table: 'notification_channels', method: 'update', clear: false, provider: 'slack' },
]

beforeEach(() => {
  vi.clearAllMocks()
  responses = []
  queries.length = 0
  client.auth.getUser.mockResolvedValue({ data: { user: { id: 'sample-user' } } })
  mocks.createClient.mockResolvedValue(client)
  mocks.requireAdminClient.mockReturnValue({ from })
  mocks.ensurePrimaryOrg.mockResolvedValue('sample-org')
  mocks.userHasOrgRole.mockResolvedValue(true)
})

describe('notification persistence acknowledgements (no database connection)', () => {
  for (const scenario of cases) describe(scenario.name, () => {
    it('acknowledges only a successful write and retains tenant/provider scope', async () => {
      responses = [...scenario.before, ok(scenario.clear ? null : [{ id: 'sample-result', org_id: 'sample-org' }])]
      await expect(scenario.run()).resolves.toEqual({ ok: true, data: undefined })
      expect(responses).toHaveLength(0)
      expect(mocks.userHasOrgRole).toHaveBeenCalledWith(client, 'sample-org', 'sample-user')
      const write = queries.at(-1)!
      expect(write.table).toBe(scenario.table)
      expect(write.steps[0].method).toBe(scenario.method)
      if (['insert', 'upsert'].includes(scenario.method)) {
        expect(write.steps[0].args[0]).toMatchObject({ org_id: 'sample-org', created_by: 'sample-user' })
        if (scenario.provider) expect(write.steps[0].args[0]).toMatchObject({ provider: scenario.provider })
      } else {
        expect(write.steps).toContainEqual({ method: 'eq', args: ['org_id', 'sample-org'] })
        if (scenario.provider) {
          expect(write.steps).toContainEqual({ method: 'eq', args: ['provider', scenario.provider] })
          expect(write.steps).toContainEqual({ method: 'is', args: ['deleted_at', null] })
        }
      }
      for (const read of queries.slice(0, -1)) expect(read.steps).toContainEqual({ method: 'eq', args: ['org_id', 'sample-org'] })
      if (!scenario.clear) expect(write.steps.at(-1)).toEqual({ method: 'select', args: [scenario.method === 'upsert' ? 'org_id' : 'id'] })
      expect(mocks.revalidatePath.mock.calls).toEqual([['/app/monitors'], ['/app/settings/notifications']])
      expect(mocks.trackServer).toHaveBeenCalledTimes(scenario.provider === 'slack' && !scenario.clear ? 1 : 0)
    })

    it('returns a safe failure on persistence error without success side effects', async () => {
      responses = [...scenario.before, failure]
      const result = await scenario.run()
      expect(result).toEqual(safeFailure)
      expect(JSON.stringify(result)).not.toContain('PRIVATE_POSTING_CREDENTIAL')
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
      expect(mocks.trackServer).not.toHaveBeenCalled()
    })

    it('does not acknowledge a thrown transport failure or retry the mutation', async () => {
      responses = [...scenario.before, new Error('simulated connection loss')]
      await expect(scenario.run()).rejects.toThrow('simulated connection loss')
      expect(queries).toHaveLength(scenario.before.length + 1)
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
      expect(mocks.trackServer).not.toHaveBeenCalled()
    })

    it('rejects denied roles before requesting a service-role client', async () => {
      mocks.userHasOrgRole.mockResolvedValue(false)
      await expect(scenario.run()).resolves.toMatchObject({ ok: false, message: 'alertActions.adminOnly' })
      expect(mocks.requireAdminClient).not.toHaveBeenCalled()
      expect(queries).toHaveLength(0)
    })

    if (!scenario.clear) it('does not claim success when an insert/update returns no affected row', async () => {
      responses = [...scenario.before, ok([])]
      await expect(scenario.run()).resolves.toEqual(safeFailure)
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
      expect(mocks.trackServer).not.toHaveBeenCalled()
    })
  })

  for (const scenario of cases.filter(c => c.before.length > 0)) for (let index = 0; index < scenario.before.length; index++) {
    it(`${scenario.name}: read ${index + 1} failure cannot fall through into a mutation`, async () => {
      responses = [...scenario.before.slice(0, index), failure]
      await expect(scenario.run()).resolves.toEqual(safeFailure)
      expect(queries).toHaveLength(index + 1)
      expect(queries.every(q => q.steps[0].method === 'select')).toBe(true)
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
      expect(mocks.trackServer).not.toHaveBeenCalled()
    })
  }

  for (const run of [() => setSlackWebhook(''), () => setDiscordWebhook(''), () => setAlertSlackChannel('', '')]) {
    it('rejects unauthenticated users before organization or admin access', async () => {
      client.auth.getUser.mockResolvedValue({ data: { user: null } })
      await expect(run()).resolves.toEqual({ ok: false, reason: 'unauthorized' })
      expect(mocks.ensurePrimaryOrg).not.toHaveBeenCalled()
      expect(mocks.requireAdminClient).not.toHaveBeenCalled()
    })
    it('returns unconfigured without attempting any database operation', async () => {
      mocks.createClient.mockResolvedValue(null)
      await expect(run()).resolves.toEqual({ ok: false, reason: 'unconfigured' })
      expect(mocks.requireAdminClient).not.toHaveBeenCalled()
      expect(queries).toHaveLength(0)
    })
  }

  it('retains webhook host validation before service-role access', async () => {
    await expect(setSlackWebhook('https://example.com/secret')).resolves.toMatchObject({ ok: false, message: 'alertActions.slackWebhookInvalid' })
    await expect(setDiscordWebhook('https://example.com/secret')).resolves.toMatchObject({ ok: false, message: 'alertActions.discordWebhookInvalid' })
    expect(mocks.requireAdminClient).not.toHaveBeenCalled()
  })

  it('keeps missing Slack connection distinct from a failed connection read', async () => {
    responses = [ok([])]
    await expect(setAlertSlackChannel('sample-channel', '')).resolves.toMatchObject({ ok: false, message: 'alertActions.slackConnectFirst' })
    expect(queries).toHaveLength(1)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
