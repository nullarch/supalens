import { afterEach, describe, expect, it } from 'vitest'

import {
  DEMO_DATA_ANCHOR,
  DEMO_DATA_RELEASED_AT,
  clientIpFrom,
  demoCacheCutoff,
  demoConcurrencyKey,
  demoDataWindowStart,
  demoMaxInFlight,
  demoMaxRunsPerDay,
  demoRunsPerVisitorPerDay,
  hashDemoIp,
  normalizeDemoQuestion,
  publicDemoConfigured,
  publicDemoOrgId,
} from './public-demo'
import { isServableDemoAnswer } from './service'

const ENV_KEYS = [
  'PUBLIC_DEMO_ORG_ID',
  'DEMO_DATABASE_URL',
  'DEMO_RUNS_PER_VISITOR_PER_DAY',
  'DEMO_MAX_RUNS_PER_DAY',
  'DEMO_MAX_INFLIGHT',
  'DEMO_IP_SALT',
] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('publicDemoConfigured', () => {
  it('requires BOTH the org id and the demo database', () => {
    delete process.env.PUBLIC_DEMO_ORG_ID
    delete process.env.DEMO_DATABASE_URL
    expect(publicDemoConfigured()).toBe(false)
    process.env.PUBLIC_DEMO_ORG_ID = 'org-1'
    expect(publicDemoConfigured()).toBe(false)
    process.env.DEMO_DATABASE_URL = 'postgres://demo'
    expect(publicDemoConfigured()).toBe(true)
  })

  it('treats a whitespace-only org id as unset', () => {
    process.env.PUBLIC_DEMO_ORG_ID = '   '
    expect(publicDemoOrgId()).toBeNull()
  })
})

describe('caps env overrides', () => {
  it('uses defaults when unset or invalid', () => {
    delete process.env.DEMO_RUNS_PER_VISITOR_PER_DAY
    process.env.DEMO_MAX_RUNS_PER_DAY = 'not-a-number'
    process.env.DEMO_MAX_INFLIGHT = '-3'
    expect(demoRunsPerVisitorPerDay()).toBe(5)
    expect(demoMaxRunsPerDay()).toBe(150)
    expect(demoMaxInFlight()).toBe(4)
  })

  it('honors positive integer overrides', () => {
    process.env.DEMO_RUNS_PER_VISITOR_PER_DAY = '10'
    expect(demoRunsPerVisitorPerDay()).toBe(10)
  })
})

describe('normalizeDemoQuestion', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeDemoQuestion('  What was\n  revenue   last week? ')).toBe('What was revenue last week?')
  })
  it('preserves case (identifiers users type must read back verbatim)', () => {
    expect(normalizeDemoQuestion('Revenue in KRW')).toBe('Revenue in KRW')
  })
  it('reduces whitespace-only input to empty', () => {
    expect(normalizeDemoQuestion(' \n\t ')).toBe('')
  })
})

describe('hashDemoIp', () => {
  it('is deterministic and never echoes the ip', () => {
    process.env.DEMO_IP_SALT = 'test-salt'
    const a = hashDemoIp('203.0.113.7')
    expect(hashDemoIp('203.0.113.7')).toBe(a)
    expect(a).not.toContain('203')
    expect(a).toHaveLength(32)
  })
  it('changes with the salt', () => {
    process.env.DEMO_IP_SALT = 'salt-a'
    const a = hashDemoIp('203.0.113.7')
    process.env.DEMO_IP_SALT = 'salt-b'
    expect(hashDemoIp('203.0.113.7')).not.toBe(a)
  })
})

describe('clientIpFrom', () => {
  it('takes the first x-forwarded-for hop', () => {
    const h = new Headers({ 'x-forwarded-for': ' 198.51.100.4 , 10.0.0.1' })
    expect(clientIpFrom(h)).toBe('198.51.100.4')
  })
  it('falls back to x-real-ip, then a shared bucket', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9')
    expect(clientIpFrom(new Headers())).toBe('unknown')
  })
})

describe('demoConcurrencyKey', () => {
  it('is deterministic and stays within the bucket range', () => {
    const keys = new Set<string>()
    for (let i = 0; i < 50; i++) keys.add(demoConcurrencyKey(`seed-${i}`))
    expect(demoConcurrencyKey('seed-1')).toBe(demoConcurrencyKey('seed-1'))
    for (const k of keys) expect(k).toMatch(/^demo-[0-3]$/)
    expect(keys.size).toBeGreaterThan(1) // actually spreads across buckets
  })
})

describe('demo data window', () => {
  const anchor = Date.parse(`${DEMO_DATA_ANCHOR}T00:00:00Z`)
  const day = 24 * 60 * 60 * 1000

  it('moves in whole weeks from the seed anchor, like the window_shift view', () => {
    expect(demoDataWindowStart(new Date(anchor + 3 * 60 * 60 * 1000)).getTime()).toBe(anchor)
    expect(demoDataWindowStart(new Date(anchor + 6 * day + 23 * 60 * 60 * 1000)).getTime()).toBe(anchor)
    expect(demoDataWindowStart(new Date(anchor + 7 * day)).getTime()).toBe(anchor + 7 * day)
    expect(demoDataWindowStart(new Date(anchor + 20 * day + 5000)).getTime()).toBe(anchor + 14 * day)
  })

  it('never serves a cached answer from an earlier data week or the retired dataset', () => {
    const released = Date.parse(DEMO_DATA_RELEASED_AT)
    expect(demoCacheCutoff(new Date(released + 60 * 1000)).getTime()).toBeGreaterThanOrEqual(released)
    const laterWeek = new Date(anchor + 9 * day + 10 * 60 * 60 * 1000)
    expect(demoCacheCutoff(laterWeek).getTime()).toBe(anchor + 7 * day)
  })
})

describe('isServableDemoAnswer', () => {
  it('replays only answers that produced a chart and prose', () => {
    expect(isServableDemoAnswer({ text: 'Revenue was $93K.', visualizations: [{ chart: { type: 'bignumber' } }] })).toBe(true)
    expect(isServableDemoAnswer({ text: 'The database tool is failing (Invalid URL).', visualizations: [] })).toBe(false)
    expect(isServableDemoAnswer({ text: '', visualizations: [{}] })).toBe(false)
    expect(isServableDemoAnswer(null)).toBe(false)
  })
})
