import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'

import { verifySlackSignature } from './client'

const SECRET = 'test_signing_secret'

function sign(timestamp: string, body: string): string {
  return 'v0=' + createHmac('sha256', SECRET).update(`v0:${timestamp}:${body}`).digest('hex')
}

describe('verifySlackSignature', () => {
  const now = () => String(Math.floor(Date.now() / 1000))

  it('accepts a valid, fresh signature', () => {
    const ts = now()
    const body = '{"type":"event_callback"}'
    expect(
      verifySlackSignature({ signingSecret: SECRET, signature: sign(ts, body), timestamp: ts, rawBody: body }),
    ).toBe(true)
  })

  it('rejects a tampered body (HMAC mismatch)', () => {
    const ts = now()
    const sig = sign(ts, '{"type":"event_callback"}')
    expect(
      verifySlackSignature({ signingSecret: SECRET, signature: sig, timestamp: ts, rawBody: '{"type":"evil"}' }),
    ).toBe(false)
  })

  it('rejects a stale timestamp (replay window >5min)', () => {
    const stale = String(Math.floor(Date.now() / 1000) - 60 * 6)
    const body = '{}'
    expect(
      verifySlackSignature({ signingSecret: SECRET, signature: sign(stale, body), timestamp: stale, rawBody: body }),
    ).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    const ts = now()
    const body = '{}'
    const wrong = 'v0=' + createHmac('sha256', 'other_secret').update(`v0:${ts}:${body}`).digest('hex')
    expect(
      verifySlackSignature({ signingSecret: SECRET, signature: wrong, timestamp: ts, rawBody: body }),
    ).toBe(false)
  })

  it('rejects missing signature or timestamp', () => {
    expect(verifySlackSignature({ signingSecret: SECRET, signature: null, timestamp: now(), rawBody: '{}' })).toBe(false)
    expect(verifySlackSignature({ signingSecret: SECRET, signature: 'v0=abc', timestamp: null, rawBody: '{}' })).toBe(false)
  })
})
