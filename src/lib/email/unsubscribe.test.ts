import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { signUnsubToken, verifyUnsubToken, unsubscribeUrl } from './unsubscribe'
import { escapeHtml } from './escape'

const ARGS = { userId: '11111111-1111-1111-1111-111111111111', orgId: '22222222-2222-2222-2222-222222222222', kind: 'digest' as const }

describe('unsubscribe token', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-master-key-for-unsub-tokens')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round-trips sign → verify', () => {
    const token = signUnsubToken(ARGS)
    expect(token).toBeTruthy()
    const payload = verifyUnsubToken(token as string)
    expect(payload).toMatchObject({ userId: ARGS.userId, orgId: ARGS.orgId, kind: 'digest' })
  })

  it('rejects a tampered payload (signature mismatch)', () => {
    const token = signUnsubToken(ARGS) as string
    const [body, sig] = token.split('.')
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    decoded.kind = 'alert' // flip the kind without re-signing
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`
    expect(verifyUnsubToken(forged)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const token = signUnsubToken(ARGS) as string
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA')
    expect(verifyUnsubToken(flipped)).toBeNull()
  })

  it('rejects an expired token', () => {
    const past = Date.now() - 365 * 24 * 60 * 60 * 1000 // signed a year ago (TTL 180d)
    const token = signUnsubToken(ARGS, past) as string
    expect(verifyUnsubToken(token)).toBeNull()
    // …but the same token verifies at its signing time
    expect(verifyUnsubToken(token, past)).not.toBeNull()
  })

  it('rejects garbage input shapes', () => {
    expect(verifyUnsubToken('')).toBeNull()
    expect(verifyUnsubToken('no-dot')).toBeNull()
    expect(verifyUnsubToken('a.b')).toBeNull()
    expect(verifyUnsubToken('.sig')).toBeNull()
    expect(verifyUnsubToken('body.')).toBeNull()
  })

  it('degrades to null (never throws) when the signing key is unavailable', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(signUnsubToken(ARGS)).toBeNull()
    expect(verifyUnsubToken('anything.else')).toBeNull()
    expect(unsubscribeUrl(ARGS)).toBeNull()
  })

  it('signed with one key does not verify under another', () => {
    const token = signUnsubToken(ARGS) as string
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'a-different-master-key')
    expect(verifyUnsubToken(token)).toBeNull()
  })

  it('builds the unsubscribe URL off NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.supalens.ai/')
    const url = unsubscribeUrl(ARGS) as string
    expect(url).toMatch(/^https:\/\/www\.supalens\.ai\/api\/email\/unsubscribe\?token=/)
  })
})

describe('escapeHtml', () => {
  it('escapes markup-significant characters', () => {
    expect(escapeHtml(`<img src=x onerror="pwn('&')">`)).toBe(
      '&lt;img src=x onerror=&quot;pwn(&#39;&amp;&#39;)&quot;&gt;',
    )
  })
  it('passes plain text through', () => {
    expect(escapeHtml('우리 조직 — Weekly Digest 100%')).toBe('우리 조직 — Weekly Digest 100%')
  })
})
