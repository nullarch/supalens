import { afterEach, describe, expect, it, vi } from 'vitest'

/** The hub forgets a person only after their auth user is really gone. */

const forgetHubPerson = vi.fn()
vi.mock('@/lib/event-hub/events', () => ({
  forgetHubPerson: (...args: unknown[]) => forgetHubPerson(...args),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: vi.fn(), get: vi.fn() }) }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/lib/supabase-oauth/disconnect', () => ({ disconnectSupabase: vi.fn() }))
vi.mock('@/lib/github-app/disconnect', () => ({ disconnectGithub: vi.fn() }))
vi.mock('@/lib/slack-app/disconnect', () => ({ disconnectSlack: vi.fn() }))
vi.mock('@/lib/data-sources/remove', () => ({ removeDirectDataSource: vi.fn() }))
vi.mock('@/lib/mcp/keys', () => ({ revokeAllApiKeysForOrg: vi.fn() }))
vi.mock('@/lib/org/server', () => ({ ACTIVE_ORG_COOKIE: 'org' }))
vi.mock('@/utils/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: null } } }) } }),
}))

const deleteUser = vi.fn()
vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    auth: { admin: { deleteUser: (...args: unknown[]) => deleteUser(...args) } },
    // A user with no memberships: nothing to tear down.
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  }),
}))

import { deleteAccount } from './delete'

afterEach(() => vi.clearAllMocks())

describe('deleteAccount → event hub', () => {
  it('forgets the person after the auth user is deleted', async () => {
    deleteUser.mockResolvedValue({ error: null })
    expect(await deleteAccount()).toEqual({ ok: true, data: undefined })
    expect(forgetHubPerson).toHaveBeenCalledWith('user-1')
    expect(deleteUser.mock.invocationCallOrder[0]).toBeLessThan(forgetHubPerson.mock.invocationCallOrder[0])
  })

  it('forgets nothing while the auth user still exists', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    deleteUser.mockResolvedValue({ error: { message: 'nope' } })
    expect((await deleteAccount()).ok).toBe(false)
    expect(forgetHubPerson).not.toHaveBeenCalled()
  })
})
