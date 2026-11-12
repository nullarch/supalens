import { describe, expect, it } from 'vitest'

import { cadenceParts, healthOf, nextCheckAt } from './health'

describe('healthOf', () => {
  it('paused wins over a firing status', () => {
    expect(healthOf({ enabled: false, status: 'firing', lastError: 'boom' })).toBe('paused')
  })
  it('incident when enabled + firing (even with a stale error)', () => {
    expect(healthOf({ enabled: true, status: 'firing', lastError: 'old' })).toBe('incident')
  })
  it('error when the last evaluation failed', () => {
    expect(healthOf({ enabled: true, status: 'normal', lastError: 'relation missing' })).toBe('error')
  })
  it('healthy otherwise', () => {
    expect(healthOf({ enabled: true, status: 'normal', lastError: null })).toBe('healthy')
  })
})

describe('nextCheckAt', () => {
  const now = Date.parse('2026-09-04T10:00:00Z')
  const FIVE = 300
  it('null when paused', () => {
    expect(nextCheckAt({ enabled: false, lastCheckedAt: null }, FIVE, now)).toBeNull()
  })
  it('never checked → now + one interval (the next cron tick upper bound)', () => {
    expect(nextCheckAt({ enabled: true, lastCheckedAt: null }, FIVE, now)?.getTime()).toBe(now + FIVE * 1000)
  })
  it('last + interval when in the future', () => {
    const last = new Date(now - 60_000).toISOString()
    expect(nextCheckAt({ enabled: true, lastCheckedAt: last }, FIVE, now)?.getTime()).toBe(now - 60_000 + FIVE * 1000)
  })
  it('overdue → clamped to now, never a past time', () => {
    const last = new Date(now - 3 * FIVE * 1000).toISOString()
    expect(nextCheckAt({ enabled: true, lastCheckedAt: last }, FIVE, now)?.getTime()).toBe(now)
  })
  it('honours the per-plan interval (free = 2h)', () => {
    const last = new Date(now - 60_000).toISOString()
    expect(nextCheckAt({ enabled: true, lastCheckedAt: last }, 7200, now)?.getTime()).toBe(now - 60_000 + 7200 * 1000)
  })
})

describe('cadenceParts', () => {
  it('5 min → minutes', () => expect(cadenceParts(300)).toEqual({ unit: 'minutes', n: 5 }))
  it('10 min → minutes', () => expect(cadenceParts(600)).toEqual({ unit: 'minutes', n: 10 }))
  it('2 h → hours', () => expect(cadenceParts(7200)).toEqual({ unit: 'hours', n: 2 }))
  it('90 min → minutes (not a whole hour)', () => expect(cadenceParts(5400)).toEqual({ unit: 'minutes', n: 90 }))
  it('never below one minute', () => expect(cadenceParts(1)).toEqual({ unit: 'minutes', n: 1 }))
})
