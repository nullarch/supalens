import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'

import { verifyPaddleSignature } from './webhook-verify'

/**
 * Pin: Paddle webhook signature scheme — HMAC-SHA256 over `${ts}:${rawBody}`, and
 * MULTIPLE `h1` entries (sent during a webhook-secret rotation) must pass if ANY
 * matches. A last-h1-wins parser silently 401s every event for the whole rotation
 * window (the bug this file pins against).
 */

const SECRET = 'whsec_test'
const RAW = '{"event_id":"evt_1","data":{}}'
const NOW = 1_800_000_000_000 // fixed clock (ms)

function sign(secret: string, ts: number, raw: string): string {
  return createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex')
}

describe('verifyPaddleSignature', () => {
  const ts = Math.floor(NOW / 1000)

  it('accepts a valid single-h1 signature', () => {
    const header = `ts=${ts};h1=${sign(SECRET, ts, RAW)}`
    expect(verifyPaddleSignature(SECRET, RAW, header, NOW)).toBe(true)
  })

  it('accepts when ANY of multiple h1 entries matches (secret rotation)', () => {
    const otherSecretSig = sign('whsec_old', ts, RAW)
    const ourSig = sign(SECRET, ts, RAW)
    // our matching h1 FIRST, a foreign one last — a "last h1 wins" parser fails this
    expect(verifyPaddleSignature(SECRET, RAW, `ts=${ts};h1=${ourSig};h1=${otherSecretSig}`, NOW)).toBe(true)
    // and the reverse order
    expect(verifyPaddleSignature(SECRET, RAW, `ts=${ts};h1=${otherSecretSig};h1=${ourSig}`, NOW)).toBe(true)
  })

  it('rejects when no h1 entry matches', () => {
    const header = `ts=${ts};h1=${sign('whsec_a', ts, RAW)};h1=${sign('whsec_b', ts, RAW)}`
    expect(verifyPaddleSignature(SECRET, RAW, header, NOW)).toBe(false)
  })

  it('rejects a tampered body', () => {
    const header = `ts=${ts};h1=${sign(SECRET, ts, RAW)}`
    expect(verifyPaddleSignature(SECRET, RAW.replace('evt_1', 'evt_2'), header, NOW)).toBe(false)
  })

  it('rejects a stale timestamp (> 300s skew)', () => {
    const oldTs = ts - 301
    const header = `ts=${oldTs};h1=${sign(SECRET, oldTs, RAW)}`
    expect(verifyPaddleSignature(SECRET, RAW, header, NOW)).toBe(false)
  })

  it('accepts within the 300s tolerance', () => {
    const recentTs = ts - 299
    const header = `ts=${recentTs};h1=${sign(SECRET, recentTs, RAW)}`
    expect(verifyPaddleSignature(SECRET, RAW, header, NOW)).toBe(true)
  })

  it('rejects malformed headers', () => {
    expect(verifyPaddleSignature(SECRET, RAW, '', NOW)).toBe(false)
    expect(verifyPaddleSignature(SECRET, RAW, 'garbage', NOW)).toBe(false)
    expect(verifyPaddleSignature(SECRET, RAW, `h1=${sign(SECRET, ts, RAW)}`, NOW)).toBe(false) // no ts
    expect(verifyPaddleSignature(SECRET, RAW, `ts=${ts}`, NOW)).toBe(false) // no h1
    expect(verifyPaddleSignature(SECRET, RAW, `ts=abc;h1=${sign(SECRET, ts, RAW)}`, NOW)).toBe(false)
  })
})
