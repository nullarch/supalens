import { afterEach, describe, expect, it } from 'vitest'

import { adminTestPriceId, configuredPrices, planForPriceId } from './config'

const ENV_KEYS = [
  'PADDLE_PRICE_ID_BASIC',
  'PADDLE_PRICE_ID_STANDARD',
  'PADDLE_PRICE_ID_PREMIUM',
  'PADDLE_PRICE_ID_BASIC_YEARLY',
  'PADDLE_PRICE_ID_ADMIN_TEST',
] as const

const saved: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) saved[k] = process.env[k]

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('planForPriceId', () => {
  it('maps configured tier price ids to their plan + interval', () => {
    process.env.PADDLE_PRICE_ID_BASIC = 'pri_basic_m'
    process.env.PADDLE_PRICE_ID_BASIC_YEARLY = 'pri_basic_y'
    expect(planForPriceId('pri_basic_m')).toEqual({ plan: 'basic', interval: 'month' })
    expect(planForPriceId('pri_basic_y')).toEqual({ plan: 'basic', interval: 'year' })
    expect(planForPriceId('pri_unknown')).toBeNull()
  })

  it('maps the staff $1 test price to premium/month', () => {
    process.env.PADDLE_PRICE_ID_ADMIN_TEST = 'pri_admin_test'
    expect(planForPriceId('pri_admin_test')).toEqual({ plan: 'premium', interval: 'month' })
  })

  it('returns null for the admin-test id when the env var is unset', () => {
    delete process.env.PADDLE_PRICE_ID_ADMIN_TEST
    expect(adminTestPriceId()).toBeNull()
    expect(planForPriceId('pri_admin_test')).toBeNull()
  })
})

describe('configuredPrices', () => {
  it('never exposes the admin-test price in the public catalog', () => {
    process.env.PADDLE_PRICE_ID_BASIC = 'pri_basic_m'
    process.env.PADDLE_PRICE_ID_ADMIN_TEST = 'pri_admin_test'
    const ids = configuredPrices().map((p) => p.priceId)
    expect(ids).toContain('pri_basic_m')
    expect(ids).not.toContain('pri_admin_test')
  })
})
