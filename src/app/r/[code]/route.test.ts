import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Pins for the content-agent capture on the tracked-link route: a strict-UUID ca_variant sets the
// first-touch sl_cav cookie (HttpOnly/Secure/Lax, 30d) without disturbing the redirect or sl_ref;
// junk, an existing valid cookie, or an unconfigured env → no cookie.
const { jar, recordRefClick } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  recordRefClick: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined) }),
}))
vi.mock('@/lib/attribution/service', () => ({
  REF_COOKIE: 'sl_ref',
  REF_COOKIE_MAX_AGE: 2_592_000,
  clientIpFrom: () => '203.0.113.9',
  hashVisitorIp: () => 'h',
  isRefCode: (c: string) => /^[A-Za-z0-9]{6,16}$/.test(c),
  recordRefClick,
}))

import { GET } from './route'

const VARIANT = '0f8e2a4c-1b2d-4e5f-8a9b-0c1d2e3f4a5b'
const CAMPAIGN = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'

async function hit(code: string, query: string) {
  return GET(new Request(`https://supalens.ai/r/${code}?${query}`), { params: Promise.resolve({ code }) })
}
const cav = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('sl_cav='))

beforeEach(() => {
  jar.clear()
  recordRefClick.mockReset().mockResolvedValue({ matched: true })
  process.env.CONTENT_AGENT_TRACKING_URL = 'https://track.example.com/tracking/supalens/events'
  process.env.CONTENT_AGENT_TRACKING_TOKEN = 'tok'
  process.env.NEXT_PUBLIC_APP_URL = 'https://supalens.ai'
})
afterEach(() => {
  delete process.env.CONTENT_AGENT_TRACKING_URL
  delete process.env.CONTENT_AGENT_TRACKING_TOKEN
  delete process.env.NEXT_PUBLIC_APP_URL
})

const TRACKED = `to=/x&utm_source=x&utm_medium=social&utm_campaign=c&utm_content=p&ca_service=supalens&ca_variant=${VARIANT}&utm_id=${CAMPAIGN}`

describe('/r/<code> content-agent capture', () => {
  it('sets sl_cav alongside sl_ref and keeps the redirect unchanged', async () => {
    const res = await hit('CampA123', TRACKED)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://supalens.ai/x')
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sl_ref=CampA123'))).toBe(true)
    const cookie = cav(res)!
    expect(cookie).toMatch(new RegExp(`^sl_cav=v1\\.${VARIANT}\\.${CAMPAIGN}\\.\\d+;`))
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Max-Age=2592000/)
  })
  it('captures even when the ref code is unknown (the variant is the attribution)', async () => {
    recordRefClick.mockResolvedValue({ matched: false })
    expect(cav(await hit('Nobody12', TRACKED))).toBeDefined()
    expect(cav(await hit('bad', TRACKED))).toBeDefined() // not even a ref-code shape
  })
  it('first touch wins — an existing valid sl_cav is never overwritten', async () => {
    jar.set('sl_cav', `v1.${CAMPAIGN}..1790000000`)
    expect(cav(await hit('CampA123', TRACKED))).toBeUndefined()
  })
  it('a junk existing cookie is replaced', async () => {
    jar.set('sl_cav', 'garbage')
    expect(cav(await hit('CampA123', TRACKED))).toBeDefined()
  })
  it('ignores a junk ca_variant', async () => {
    expect(cav(await hit('CampA123', 'to=/x&ca_variant=not-a-uuid'))).toBeUndefined()
  })
  it('is a no-op when content-agent is unconfigured', async () => {
    delete process.env.CONTENT_AGENT_TRACKING_URL
    const res = await hit('CampA123', TRACKED)
    expect(cav(res)).toBeUndefined()
    expect(res.headers.get('location')).toBe('https://supalens.ai/x')
  })
})
