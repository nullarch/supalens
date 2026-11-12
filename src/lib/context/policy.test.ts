// Pin tests for the context-extraction plan policy (billing invariant): free = one lifetime
// tier-2 extraction, push auto-regen only on cooldown-enabled plans. If PLAN_LIMITS changes
// these numbers, this file must change in the same commit — that is the point.
import { describe, expect, it } from 'vitest'

import { canExtractContext, shouldAutoRegenContext } from './policy'

describe('canExtractContext', () => {
  it('free plan allows exactly one lifetime extraction', () => {
    expect(canExtractContext('free', 0)).toBe(true)
    expect(canExtractContext('free', 1)).toBe(false)
    expect(canExtractContext('free', 5)).toBe(false)
  })

  it('paid plans are unlimited', () => {
    for (const plan of ['basic', 'standard', 'premium'] as const) {
      expect(canExtractContext(plan, 0)).toBe(true)
      expect(canExtractContext(plan, 1_000)).toBe(true)
    }
  })
})

describe('shouldAutoRegenContext', () => {
  const now = new Date('2026-07-23T12:00:00Z')
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

  it('free and basic never auto-regen (push marks stale only)', () => {
    for (const plan of ['free', 'basic'] as const) {
      expect(shouldAutoRegenContext(plan, null, now)).toBe(false)
      expect(shouldAutoRegenContext(plan, hoursAgo(24 * 365), now)).toBe(false)
    }
  })

  it('standard regenerates only past the 24h cooldown', () => {
    expect(shouldAutoRegenContext('standard', hoursAgo(1), now)).toBe(false)
    expect(shouldAutoRegenContext('standard', hoursAgo(23.9), now)).toBe(false)
    expect(shouldAutoRegenContext('standard', hoursAgo(24), now)).toBe(true) // boundary is inclusive
    expect(shouldAutoRegenContext('standard', hoursAgo(48), now)).toBe(true)
  })

  it('premium regenerates only past the 6h cooldown', () => {
    expect(shouldAutoRegenContext('premium', hoursAgo(5.9), now)).toBe(false)
    expect(shouldAutoRegenContext('premium', hoursAgo(6), now)).toBe(true)
  })

  it('never-generated / unparseable timestamps are regen-eligible on cooldown plans', () => {
    expect(shouldAutoRegenContext('standard', null, now)).toBe(true)
    expect(shouldAutoRegenContext('standard', 'not-a-date', now)).toBe(true)
    expect(shouldAutoRegenContext('basic', null, now)).toBe(false) // plan gate still wins
  })

  it('accepts Date instances as well as ISO strings', () => {
    expect(shouldAutoRegenContext('premium', new Date(now.getTime() - 7 * 3_600_000), now)).toBe(true)
  })
})
