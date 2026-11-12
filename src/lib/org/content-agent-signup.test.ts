import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// Regression pin: BOTH org-creation paths (ensurePrimaryOrg's auto-created first workspace and
// createOrg) hand the new org + the sl_cav cookie to the content-agent recorder, and a recorder
// failure never blocks workspace creation.
const { jar, recordContentAgentOrgCreated, rpc, user } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  recordContentAgentOrgCreated: vi.fn(),
  rpc: vi.fn(),
  user: { id: 'user-1234567890', email: 'sample@example.com' },
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en', getTranslations: async () => (k: string) => k }))
vi.mock('@/lib/attribution/service', () => ({ REF_COOKIE: 'sl_ref', recordRefConversion: vi.fn() }))
vi.mock('@/lib/email/welcome', () => ({ sendWelcomeEmail: vi.fn() }))
vi.mock('@/lib/email/invite', () => ({ sendInviteEmail: vi.fn() }))
vi.mock('@/lib/plans/usage', () => ({ enforceSeatLimit: vi.fn(), enforceInviteRateLimit: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => null }))
vi.mock('@/lib/content-agent/events', () => ({ recordContentAgentOrgCreated }))
vi.mock('@/utils/supabase/server', () => ({
  createClient: async () => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ count: 0, data: null, error: null }))
    return { auth: { getUser: async () => ({ data: { user } }) }, from: () => chain, rpc }
  },
}))

import { ensurePrimaryOrg } from './server'
import { createOrg } from './actions'

const COOKIE = 'v1.0f8e2a4c-1b2d-4e5f-8a9b-0c1d2e3f4a5b..1790000000'

function memberClient(memberships: Array<{ org_id: string }>) {
  const chain = { select: () => chain, order: async () => ({ data: memberships, error: null }) }
  return { from: () => chain, rpc } as unknown as SupabaseClient
}

beforeEach(() => {
  jar.clear()
  recordContentAgentOrgCreated.mockReset().mockResolvedValue(undefined)
  rpc.mockReset().mockResolvedValue({ data: { id: 'org-new', slug: 'acme-1a2b' }, error: null })
})

describe('content-agent signup on org creation', () => {
  it('ensurePrimaryOrg records the auto-created first workspace with the sl_cav cookie', async () => {
    jar.set('sl_cav', COOKIE)
    await expect(ensurePrimaryOrg(memberClient([]), user as User)).resolves.toBe('org-new')
    expect(recordContentAgentOrgCreated).toHaveBeenCalledExactlyOnceWith({ orgId: 'org-new', cookieValue: COOKIE })
  })
  it('ensurePrimaryOrg: an existing member creates nothing and records nothing', async () => {
    jar.set('sl_cav', COOKIE)
    await expect(ensurePrimaryOrg(memberClient([{ org_id: 'org-old' }]), user as User)).resolves.toBe('org-old')
    expect(recordContentAgentOrgCreated).not.toHaveBeenCalled()
  })
  it('ensurePrimaryOrg never blocks on a recorder failure', async () => {
    recordContentAgentOrgCreated.mockRejectedValue(new Error('PRIVATE_FAILURE'))
    await expect(ensurePrimaryOrg(memberClient([]), user as User)).resolves.toBe('org-new')
  })
  it('createOrg records the new org (cookie optional) and keeps the cookie for later workspaces', async () => {
    jar.set('sl_cav', COOKIE)
    await expect(createOrg('Acme')).resolves.toMatchObject({ ok: true, data: { id: 'org-new' } })
    expect(recordContentAgentOrgCreated).toHaveBeenCalledExactlyOnceWith({ orgId: 'org-new', cookieValue: COOKIE })
    expect(jar.get('sl_cav')).toBe(COOKIE)

    recordContentAgentOrgCreated.mockClear()
    jar.delete('sl_cav')
    await createOrg('Beta')
    expect(recordContentAgentOrgCreated).toHaveBeenCalledExactlyOnceWith({ orgId: 'org-new', cookieValue: undefined })
  })
})
