import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// Regression pin: a brand-new user's FIRST workspace (auto-created by ensurePrimaryOrg, not
// createOrg) must be credited to the campaign from the sl_ref cookie.
const { jar, recordRefConversion } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  recordRefConversion: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined) }),
}))
vi.mock('@/lib/attribution/service', () => ({ REF_COOKIE: 'sl_ref', recordRefConversion }))
vi.mock('@/lib/email/welcome', () => ({ sendWelcomeEmail: vi.fn() }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))
import { ensurePrimaryOrg } from './server'

function client(memberships: Array<{ org_id: string }>) {
  const rpc = vi.fn().mockResolvedValue({ data: { id: 'org-new' }, error: null })
  const chain = { select: () => chain, order: async () => ({ data: memberships, error: null }) }
  return { client: { from: () => chain, rpc } as unknown as SupabaseClient, rpc }
}
const user = { id: 'user-1234567890', email: 'sample@example.com' } as User

beforeEach(() => {
  jar.clear()
  recordRefConversion.mockReset().mockResolvedValue(undefined)
})

describe('ensurePrimaryOrg link attribution', () => {
  it('credits the first-touch ref code on the auto-created first workspace', async () => {
    jar.set('sl_ref', 'CampA123')
    const { client: c } = client([])
    await expect(ensurePrimaryOrg(c, user)).resolves.toBe('org-new')
    expect(recordRefConversion).toHaveBeenCalledExactlyOnceWith({
      refCode: 'CampA123',
      userId: 'user-1234567890',
      orgId: 'org-new',
    })
  })
  it('does nothing without the cookie', async () => {
    const { client: c } = client([])
    await expect(ensurePrimaryOrg(c, user)).resolves.toBe('org-new')
    expect(recordRefConversion).not.toHaveBeenCalled()
  })
  it('never blocks workspace creation when attribution fails', async () => {
    jar.set('sl_ref', 'CampA123')
    recordRefConversion.mockRejectedValue(new Error('PRIVATE_FAILURE'))
    const { client: c } = client([])
    await expect(ensurePrimaryOrg(c, user)).resolves.toBe('org-new')
  })
  it('an existing member creates no org and credits nothing', async () => {
    jar.set('sl_ref', 'CampA123')
    const { client: c, rpc } = client([{ org_id: 'org-old' }])
    await expect(ensurePrimaryOrg(c, user)).resolves.toBe('org-old')
    expect(rpc).not.toHaveBeenCalled()
    expect(recordRefConversion).not.toHaveBeenCalled()
  })
})
