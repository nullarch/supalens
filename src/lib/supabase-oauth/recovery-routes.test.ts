import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), cookies: vi.fn(), target: vi.fn(), reauthorize: vi.fn(), exchange: vi.fn(), connect: vi.fn(), track: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@/utils/supabase/server', () => ({ createClient: mocks.create }))
vi.mock('@/lib/supabase-oauth/recovery', () => ({ recoveryConnection: mocks.target, reauthorizeConnection: mocks.reauthorize, RecoveryError: class extends Error { constructor(readonly reason: string) { super(reason) } } }))
vi.mock('@/lib/supabase-oauth/client', () => ({ exchangeCode: mocks.exchange }))
vi.mock('@/lib/supabase-oauth/connect', () => ({ connectSupabaseAccount: mocks.connect }))
vi.mock('@/lib/org/server', () => ({ ensurePrimaryOrg: vi.fn() }))
vi.mock('@/lib/analytics/server', () => ({ trackServer: mocks.track }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/supabase-oauth/config', async importOriginal => ({ ...await importOriginal<object>(), getSupabaseOauthConfig: () => ({ clientId: 'SAMPLE', redirectUri: 'https://sample.invalid/api/connect-supabase/callback' }) }))
import { GET as callback } from '@/app/api/connect-supabase/callback/route'
import { GET as authorize } from '@/app/api/connect-supabase/authorize/route'
import { OAUTH_COOKIE } from './config'

const id = '00000000-0000-4000-8000-000000000001', org = '00000000-0000-4000-8000-000000000002'
const values = new Map<string, string>()
const cookieStore = { get: (key: string) => values.has(key) ? { value: values.get(key) } : undefined, set: vi.fn((key: string, value: string) => values.set(key, value)), delete: vi.fn((key: string) => values.delete(key)) }
const db = { auth: { getUser: vi.fn() } }
beforeEach(() => {
  vi.clearAllMocks(); values.clear()
  mocks.cookies.mockResolvedValue(cookieStore); mocks.create.mockResolvedValue(db)
  db.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-a' } } })
  mocks.target.mockResolvedValue({ id, org_id: org }); mocks.exchange.mockResolvedValue({ accessToken: 'SAMPLE' }); mocks.reauthorize.mockResolvedValue(undefined)
  values.set(OAUTH_COOKIE.state, 'state'); values.set(OAUTH_COOKIE.verifier, 'verifier')
  values.set(OAUTH_COOKIE.returnTo, '/app/monitors/sample'); values.set(OAUTH_COOKIE.recovery, JSON.stringify({ connectionId: id, orgId: org, userId: 'user-a' }))
})
const request = (params = 'code=sample&state=state') => new Request(`https://sample.invalid/api/connect-supabase/callback?${params}`)
const reason = (response: Response) => new URL(response.headers.get('location')!).searchParams.get('recovery')
describe('targeted OAuth handoff, mocked external IO', () => {
  it.each(['/app/settings/integrations', '/app/sources', '/app/setup', '/app/ask?wizard=resume'])('carries a lookup id to the shared return card on %s', async path => {
    values.delete(OAUTH_COOKIE.recovery)
    values.set(OAUTH_COOKIE.returnTo, path)
    mocks.connect.mockResolvedValue({ connectionId: id, dispatched: true, needsSelection: false, skippedForPlan: 0 })
    const url = new URL((await callback(request())).headers.get('location')!)
    expect(url.pathname).toBe(new URL(path, 'https://sample.invalid').pathname)
    expect(url.searchParams.get('supabaseConnection')).toBe(id)
    expect(url.searchParams.get('connecting')).toBe('supabase')
    if (path.includes('wizard')) expect(url.searchParams.get('wizard')).toBe('resume')
  })
  it('carries the confirmed connection identity into project selection', async () => {
    values.delete(OAUTH_COOKIE.recovery)
    mocks.connect.mockResolvedValue({ connectionId: id, needsSelection: true })
    const url = new URL((await callback(request())).headers.get('location')!)
    expect(url.pathname).toBe('/app/setup')
    expect(url.searchParams.get('supabaseConnection')).toBe(id)
    expect(url.searchParams.get('select')).toBe('supabase')
  })
  it('returns to the original monitor without creating a replacement connection', async () => {
    const response = await callback(request())
    expect(reason(response)).toBe('authorized')
    expect(new URL(response.headers.get('location')!).searchParams.get('supabaseConnection')).toBe(id)
    expect(mocks.track).toHaveBeenCalledWith('supabase_reauthorized', 'user-a', { org_id: org, connection_id: id })
    expect(new URL(response.headers.get('location')!).pathname).toBe('/app/monitors/sample')
    expect(mocks.target.mock.invocationCallOrder[0]).toBeLessThan(mocks.exchange.mock.invocationCallOrder[0])
    expect(mocks.reauthorize).toHaveBeenCalledWith(db, 'user-a', id, org, { accessToken: 'SAMPLE' })
    expect(mocks.connect).not.toHaveBeenCalled(); expect(values.size).toBe(0)
  })
  it.each([['error=access_denied', 'cancelled'], ['code=sample&state=wrong', 'expired'], ['state=state', 'expired']])('handles %s without exchanging a token', async (params, expected) => { expect(reason(await callback(request(params)))).toBe(expected); expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.connect).not.toHaveBeenCalled() })
  it('does not switch a malformed recovery handoff to new-connection mode', async () => { values.set(OAUTH_COOKIE.recovery, '{bad'); expect(reason(await callback(request()))).toBe('unavailable'); expect(mocks.connect).not.toHaveBeenCalled() })
  it('rejects a handoff started by another user', async () => { db.auth.getUser.mockResolvedValue({ data: { user: { id: 'other-user' } } }); expect(reason(await callback(request()))).toBe('denied'); expect(mocks.exchange).not.toHaveBeenCalled() })
  it('does not exchange a code when the connection is no longer visible', async () => { mocks.target.mockRejectedValue(new Error('PRIVATE')); expect(reason(await callback(request()))).toBe('unavailable'); expect(mocks.exchange).not.toHaveBeenCalled() })
  it('does not redirect to an external return path', async () => { values.set(OAUTH_COOKIE.returnTo, '//evil.invalid'); const url = new URL((await callback(request())).headers.get('location')!); expect(url.origin).toBe('https://sample.invalid'); expect(url.pathname).toBe('/app/monitors') })
  it('preserves an actionable explanation after signing back in', async () => { db.auth.getUser.mockResolvedValue({ data: { user: null } }); const url = new URL((await callback(request())).headers.get('location')!); expect(url.pathname).toBe('/login'); expect(url.searchParams.get('next')).toBe('/app/monitors/sample?recovery=expired'); expect(mocks.exchange).not.toHaveBeenCalled() })
  it('saves a short-lived httpOnly recovery context only after role checks', async () => {
    const response = await authorize(new Request(`https://sample.invalid/api/connect-supabase/authorize?connectionId=${id}&returnTo=/app/monitors/sample`))
    expect(response.status).toBe(307)
    expect(cookieStore.set).toHaveBeenCalledWith(OAUTH_COOKIE.recovery, JSON.stringify({ connectionId: id, orgId: org, userId: 'user-a' }), expect.objectContaining({ httpOnly: true, secure: true, maxAge: 600, sameSite: 'lax' }))
  })
  it('rejects invalid target IDs without provider redirection', async () => { const response = await authorize(new Request('https://sample.invalid/api/connect-supabase/authorize?connectionId=invalid')); expect(reason(response)).toBe('unavailable'); expect(mocks.target).not.toHaveBeenCalled(); expect(cookieStore.set).not.toHaveBeenCalled() })
})
