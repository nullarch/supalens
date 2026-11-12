import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Pin: the two direct connect paths report data_connected only after the probe and the credential store succeed. */

const sendDataConnectedToHub = vi.fn()
const putSecret = vi.fn()
const testConnection = vi.fn(async (): Promise<unknown> => ({ ok: true, latencyMs: 1 }))
const probeFirestore = vi.fn(async (): Promise<unknown> => ({ ok: true, latencyMs: 1, collections: 1 }))
const admin = {
  from: () => ({
    insert: async () => ({ error: null }),
    update: () => ({ eq: async () => ({ error: null }) }),
  }),
}

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/event-hub/events', () => ({
  sendDataConnectedToHub: (...a: unknown[]) => sendDataConnectedToHub(...a),
}))
vi.mock('@/lib/content-agent/events', () => ({ recordOwnDbConnected: vi.fn(async () => {}) }))
vi.mock('@/lib/secrets/service', () => ({ putSecret: (...a: unknown[]) => putSecret(...a) }))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: () => admin }))
vi.mock('@/lib/firestore', () => ({ probeFirestore: () => probeFirestore() }))
vi.mock('./ssrf', () => ({ resolveSafeHost: async (host: string) => ({ ip: '203.0.113.1', original: host }) }))
vi.mock('./test-connection', () => ({ testConnection: () => testConnection() }))
vi.mock('./introspect-cache', () => ({ syncSchemaCache: vi.fn(async () => {}) }))

import { registerDirectDataSource } from './register'
import { registerFirestoreDataSource } from './register-firestore'

const direct = {
  orgId: 'org-1',
  userId: 'member-1',
  input: { name: 'db', engine: 'postgres', provider: 'other', host: 'db.test', port: 5432, database: 'd', user: 'u', password: 'p', ssl: 'require' },
} as unknown as Parameters<typeof registerDirectDataSource>[0]

const firestore = {
  orgId: 'org-1',
  userId: 'member-1',
  input: { name: 'fs', serviceAccountJson: JSON.stringify({ project_id: 'p', client_email: 'c', private_key: 'k' }) },
} as unknown as Parameters<typeof registerFirestoreDataSource>[0]

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sendDataConnectedToHub.mockClear()
  putSecret.mockReset().mockResolvedValue('secret-1')
  testConnection.mockReset().mockResolvedValue({ ok: true, latencyMs: 1 })
  probeFirestore.mockReset().mockResolvedValue({ ok: true, latencyMs: 1, collections: 1 })
})

describe.each([
  ['direct', () => registerDirectDataSource(direct), () => testConnection.mockResolvedValue({ ok: false, error: 'refused' })],
  ['firestore', () => registerFirestoreDataSource(firestore), () => probeFirestore.mockResolvedValue({ ok: false, error: 'denied' })],
])('%s registration', (_name, register, failProbe) => {
  it('reports the acting user and the new source', async () => {
    const { dataSourceId } = await register()
    expect(sendDataConnectedToHub).toHaveBeenCalledWith(admin, 'member-1', dataSourceId)
  })

  it('reports nothing when the connection test fails', async () => {
    failProbe()
    await expect(register()).rejects.toThrow()
    expect(sendDataConnectedToHub).not.toHaveBeenCalled()
  })

  it('reports nothing when the credential store fails', async () => {
    putSecret.mockRejectedValue(new Error('vault'))
    await expect(register()).rejects.toThrow()
    expect(sendDataConnectedToHub).not.toHaveBeenCalled()
  })
})
