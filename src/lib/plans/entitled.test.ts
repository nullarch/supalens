import { describe, expect, it } from 'vitest'

import { entitledPlan } from './limits'

/**
 * Pin: a paid tier entitles the org ONLY while its subscription is active/trialing.
 * This single rule is shared by enforcement (checkUsageQuota) and display (billing
 * page limits, sidebar meter) — if they ever diverge again, users see "12 / 750"
 * while being blocked at 15.
 */

describe('entitledPlan', () => {
  it('keeps a paid plan while active or trialing', () => {
    expect(entitledPlan('basic', 'active')).toBe('basic')
    expect(entitledPlan('standard', 'trialing')).toBe('standard')
    expect(entitledPlan('premium', 'active')).toBe('premium')
  })

  it('downgrades a lapsed paid plan to free', () => {
    expect(entitledPlan('basic', 'past_due')).toBe('free')
    expect(entitledPlan('standard', 'paused')).toBe('free')
    expect(entitledPlan('premium', 'canceled')).toBe('free')
    expect(entitledPlan('basic', null)).toBe('free')
    expect(entitledPlan('basic', undefined)).toBe('free')
  })

  it('free stays free regardless of status', () => {
    expect(entitledPlan('free', null)).toBe('free')
    expect(entitledPlan('free', 'active')).toBe('free')
  })

  it('unknown plans resolve to free', () => {
    expect(entitledPlan('enterprise', 'active')).toBe('free')
    expect(entitledPlan(null, 'active')).toBe('free')
  })
})
