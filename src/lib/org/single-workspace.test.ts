import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// Pins for the self-hosted account model: one workspace, internal accounts, and a membership
// query that never mistakes a co-member's row for the caller's own.
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/attribution/service', () => ({ REF_COOKIE: 'sl_ref', recordRefConversion: vi.fn() }))
vi.mock('@/lib/email/welcome', () => ({ sendWelcomeEmail: vi.fn() }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }))

import { ensurePrimaryOrg, listOrgs } from './server'
import { normalizeEmail, passwordProblem } from '@/lib/instance/accounts'

const me = { id: 'user-me', email: 'me@example.com' } as User

function client(rows: unknown[], sessionUserId: string | null = me.id) {
  const rpc = vi.fn().mockResolvedValue({ data: { id: 'org-new' }, error: null })
  const chain = { select: () => chain, order: async () => ({ data: rows, error: null }) }
  const auth = { getSession: async () => ({ data: { session: sessionUserId ? { user: { id: sessionUserId } } : null } }) }
  return { client: { from: () => chain, rpc, auth } as unknown as SupabaseClient, rpc }
}

afterEach(() => {
  vi.unstubAllEnvs()
  redirect.mockClear()
})

describe('listOrgs', () => {
  const org = { id: 'org-1', name: 'Acme', slug: 'acme', deleted_at: null }

  it('lists an org once with the CALLER\'s role, however many members it has', async () => {
    // RLS returns every member row of the caller's orgs; the owner joined first.
    const { client: c } = client([
      { role: 'owner', user_id: 'user-owner', organizations: org },
      { role: 'viewer', user_id: me.id, organizations: org },
      { role: 'member', user_id: 'user-other', organizations: org },
    ])
    await expect(listOrgs(c)).resolves.toEqual([{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'viewer' }])
  })

  it('drops soft-deleted orgs', async () => {
    const { client: c } = client([{ role: 'owner', user_id: me.id, organizations: { ...org, deleted_at: '2026-01-01' } }])
    await expect(listOrgs(c)).resolves.toEqual([])
  })
})

describe('ensurePrimaryOrg', () => {
  it('ignores co-members\' rows when picking the caller\'s org', async () => {
    const { client: c, rpc } = client([
      { org_id: 'org-theirs', user_id: 'user-other' },
      { org_id: 'org-mine', user_id: me.id },
    ])
    await expect(ensurePrimaryOrg(c, me)).resolves.toBe('org-mine')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('hosted: a user with no membership gets a personal workspace', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'cloud')
    const { client: c, rpc } = client([])
    await expect(ensurePrimaryOrg(c, me)).resolves.toBe('org-new')
    expect(rpc).toHaveBeenCalledWith('create_organization', expect.any(Object))
  })

  it('self-hosted: a user with no membership never gets a workspace — they are sent away', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'selfhost')
    const { client: c, rpc } = client([])
    await expect(ensurePrimaryOrg(c, me)).rejects.toThrow('REDIRECT:/no-workspace')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('internal account input', () => {
  it('normalises and validates emails', () => {
    expect(normalizeEmail('  Dana@Example.COM ')).toBe('dana@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('a b@example.com')).toBeNull()
  })

  it('requires at least 8 characters', () => {
    expect(passwordProblem('1234567')).toBe('weak_password')
    expect(passwordProblem('12345678')).toBeNull()
  })
})
