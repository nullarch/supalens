import { describe, expect, it } from 'vitest'

import {
  COMMON_TIMEZONES,
  DEFAULT_TIMEZONE,
  formatInOrgTz,
  getOrgTimezone,
  isMissingColumnError,
  isValidTimezone,
  normalizeTimezone,
  readOrgTimezone,
  timezoneLabel,
  timezoneOptions,
  utcOffsetLabel,
} from './timezone'

describe('isValidTimezone', () => {
  it('accepts real IANA zones and UTC', () => {
    expect(isValidTimezone('Asia/Seoul')).toBe(true)
    expect(isValidTimezone('America/Los_Angeles')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
  })

  it('rejects well-shaped but non-existent zones — the reason this is not a regex', () => {
    expect(isValidTimezone('Asia/Atlantis')).toBe(false)
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false)
  })

  it('rejects non-strings, empties and absurd lengths', () => {
    expect(isValidTimezone(null)).toBe(false)
    expect(isValidTimezone(undefined)).toBe(false)
    expect(isValidTimezone(42)).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone('A'.repeat(65))).toBe(false)
  })
})

describe('normalizeTimezone', () => {
  it('passes valid zones through and falls back to UTC otherwise', () => {
    expect(normalizeTimezone('Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(normalizeTimezone('nonsense')).toBe(DEFAULT_TIMEZONE)
    expect(normalizeTimezone(null)).toBe(DEFAULT_TIMEZONE)
  })
})

describe('timezoneOptions', () => {
  it('puts the common zones first, in declared order, with no duplicates', () => {
    const opts = timezoneOptions()
    expect(opts.slice(0, COMMON_TIMEZONES.length)).toEqual([...COMMON_TIMEZONES])
    expect(new Set(opts).size).toBe(opts.length)
  })

  it('still offers the long tail', () => {
    const opts = timezoneOptions()
    expect(opts.length).toBeGreaterThan(COMMON_TIMEZONES.length)
    expect(opts).toContain('Africa/Abidjan')
  })
})

describe('utcOffsetLabel / timezoneLabel', () => {
  const midwinter = new Date('2026-01-15T00:00:00Z')

  it('states the offset as UTC±HH:MM', () => {
    expect(utcOffsetLabel('Asia/Seoul', midwinter)).toBe('UTC+09:00')
    expect(utcOffsetLabel('America/New_York', midwinter)).toBe('UTC-05:00')
  })

  it('renders a zero offset as bare UTC, not UTC+00:00', () => {
    expect(utcOffsetLabel('UTC', midwinter)).toBe('UTC')
  })

  it('tracks DST — the same zone reads differently in summer', () => {
    const midsummer = new Date('2026-07-15T00:00:00Z')
    expect(utcOffsetLabel('America/New_York', midsummer)).toBe('UTC-04:00')
  })

  it('labels a zone with its offset, and degrades to the bare name when invalid', () => {
    expect(timezoneLabel('Asia/Seoul', midwinter)).toBe('Asia/Seoul (UTC+09:00)')
    expect(timezoneLabel('Asia/Atlantis', midwinter)).toBe('Asia/Atlantis')
  })
})

describe('formatInOrgTz', () => {
  const iso = '2026-09-04T09:12:00Z'

  it('shifts the instant into the org zone — the bug this column exists to fix', () => {
    // 09:12 UTC is 18:12 in Seoul; the old `iso.slice(0,16)` renderers showed 09:12.
    expect(formatInOrgTz(iso, 'Asia/Seoul', 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false })).toBe(
      '18:12',
    )
    expect(formatInOrgTz(iso, 'America/Los_Angeles', 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false })).toBe(
      '02:12',
    )
  })

  it('returns an empty string for missing or unparsable input', () => {
    expect(formatInOrgTz(null, 'UTC')).toBe('')
    expect(formatInOrgTz(undefined, 'UTC')).toBe('')
    expect(formatInOrgTz('not-a-date', 'UTC')).toBe('')
  })

  it('falls back to UTC instead of throwing on an unknown zone', () => {
    const opts = { hour: '2-digit', minute: '2-digit', hour12: false } as const
    expect(formatInOrgTz(iso, 'Asia/Atlantis', 'en-US', opts)).toBe('09:12')
  })
})

describe('isMissingColumnError', () => {
  it('recognizes the unapplied-migration case', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true)
    expect(isMissingColumnError({ message: 'column organizations.timezone does not exist' })).toBe(true)
  })

  it('does not swallow unrelated errors', () => {
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingColumnError(null)).toBe(false)
    expect(isMissingColumnError('boom')).toBe(false)
  })
})

describe('getOrgTimezone', () => {
  const clientReturning = (result: { data: unknown; error: unknown }) => ({
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => result }) }) }),
  })

  it('reads the stored zone', async () => {
    const c = clientReturning({ data: [{ timezone: 'Asia/Seoul' }], error: null })
    await expect(getOrgTimezone(c, 'org1')).resolves.toBe('Asia/Seoul')
  })

  it('falls back to UTC when the column is missing (migration not applied yet)', async () => {
    const c = clientReturning({ data: null, error: { code: '42703' } })
    await expect(getOrgTimezone(c, 'org1')).resolves.toBe(DEFAULT_TIMEZONE)
  })

  it('falls back to UTC on no row, a null value, or a garbage value', async () => {
    await expect(getOrgTimezone(clientReturning({ data: [], error: null }), 'org1')).resolves.toBe(DEFAULT_TIMEZONE)
    await expect(getOrgTimezone(clientReturning({ data: [{ timezone: null }], error: null }), 'o')).resolves.toBe(
      DEFAULT_TIMEZONE,
    )
    await expect(getOrgTimezone(clientReturning({ data: [{ timezone: 'junk' }], error: null }), 'o')).resolves.toBe(
      DEFAULT_TIMEZONE,
    )
  })

  it('never throws when the query itself blows up', async () => {
    const c = {
      from: () => {
        throw new Error('network')
      },
    } as never
    await expect(getOrgTimezone(c, 'org1')).resolves.toBe(DEFAULT_TIMEZONE)
  })

  it('readOrgTimezone flags the unapplied migration, and only that case', async () => {
    await expect(readOrgTimezone(clientReturning({ data: null, error: { code: '42703' } }), 'o')).resolves.toEqual({
      timezone: DEFAULT_TIMEZONE,
      pendingMigration: true,
    })
    // An RLS miss or a transient failure is NOT a missing column — the note must not claim it is.
    await expect(
      readOrgTimezone(clientReturning({ data: null, error: { code: '42501', message: 'permission denied' } }), 'o'),
    ).resolves.toEqual({ timezone: DEFAULT_TIMEZONE, pendingMigration: false })
    await expect(
      readOrgTimezone(clientReturning({ data: [{ timezone: 'Asia/Seoul' }], error: null }), 'o'),
    ).resolves.toEqual({ timezone: 'Asia/Seoul', pendingMigration: false })
  })
})
