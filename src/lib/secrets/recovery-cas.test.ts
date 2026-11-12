import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), encrypt: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: mocks.admin }))
vi.mock('@/lib/crypto/envelope', () => ({ encryptSecret: mocks.encrypt, decryptSecret: vi.fn() }))
import { casUpdateSecret } from './service'

let result: { data: unknown; error: unknown }
const calls: unknown[][] = []
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; result = { data: [], error: null }
  mocks.encrypt.mockResolvedValue({ ciphertext: 'SAMPLE_ENCRYPTED', nonce: 'SAMPLE_NONCE', dekId: 'sample-dek', aadVersion: 1 })
  mocks.admin.mockReturnValue({ from(table: string) {
    const builder: Record<string, unknown> = {}
    for (const method of ['update', 'eq', 'select', 'insert']) builder[method] = (...args: unknown[]) => { calls.push([table, method, ...args]); return builder }
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return builder
  } })
})
it('a refresh cannot overwrite a revoked/demoted/replaced current credential', async () => {
  expect(await casUpdateSecret({ secretId: 'old-id', orgId: 'org-a', kind: 'oauth_refresh_token', expectedVersion: 3, newPlaintext: 'SAMPLE_REFRESH', actor: { kind: 'system' } })).toBeNull()
  for (const [key, value] of [['id', 'old-id'], ['org_id', 'org-a'], ['kind', 'oauth_refresh_token'], ['version', 3], ['is_current', true], ['status', 'active']]) expect(calls).toContainEqual(['secrets', 'eq', key, value])
  expect(calls.some(call => call[0] === 'secret_access_log')).toBe(false)
})
