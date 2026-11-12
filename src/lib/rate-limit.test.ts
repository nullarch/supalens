import { beforeEach, describe, expect, it } from 'vitest'

import { rateLimit, _resetRateLimiter } from './rate-limit'

describe('rateLimit', () => {
  beforeEach(() => _resetRateLimiter())

  it('allows up to the limit within a window', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 5; i++) {
      expect(rateLimit('k', 5, 60_000, t0 + i).allowed).toBe(true)
    }
    const blocked = rateLimit('k', 5, 60_000, t0 + 10)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('resets after the window elapses', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 6; i++) rateLimit('k', 5, 60_000, t0)
    expect(rateLimit('k', 5, 60_000, t0 + 60_001).allowed).toBe(true)
  })

  it('keys are independent', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 6; i++) rateLimit('a', 5, 60_000, t0)
    expect(rateLimit('a', 5, 60_000, t0).allowed).toBe(false)
    expect(rateLimit('b', 5, 60_000, t0).allowed).toBe(true)
  })

  it('retryAfterSec reflects remaining window', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 6; i++) rateLimit('k', 5, 60_000, t0)
    const r = rateLimit('k', 5, 60_000, t0 + 30_000)
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBe(30)
  })
})
