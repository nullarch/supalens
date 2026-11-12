import { describe, expect, it } from 'vitest'

import { isAllowedReturnUrl } from './auth'

const livePartner = { allowed_origins: ['https://partner.example', 'https://www.partner.example'], is_test: false }
const testPartner = { allowed_origins: ['http://localhost:3070'], is_test: true }

describe('isAllowedReturnUrl', () => {
  it('accepts an exactly-listed https origin', () => {
    expect(isAllowedReturnUrl(livePartner, 'https://partner.example/flow/subscribe/success?x=1')).toBe(true)
  })

  it('rejects an unlisted origin (subdomain is a different origin)', () => {
    expect(isAllowedReturnUrl(livePartner, 'https://evil.partner.example.attacker.io/cb')).toBe(false)
    expect(isAllowedReturnUrl(livePartner, 'https://app.partner.example/cb')).toBe(false)
  })

  it('rejects http for live partners even if somehow listed', () => {
    const partner = { allowed_origins: ['http://partner.example'], is_test: false }
    expect(isAllowedReturnUrl(partner, 'http://partner.example/cb')).toBe(false)
  })

  it('allows localhost http for test partners only', () => {
    expect(isAllowedReturnUrl(testPartner, 'http://localhost:3070/checkout/success')).toBe(true)
    expect(isAllowedReturnUrl(testPartner, 'http://127.0.0.1:3070/cb')).toBe(true)
    expect(isAllowedReturnUrl(livePartner, 'http://localhost:3070/cb')).toBe(false)
  })

  it('rejects garbage URLs', () => {
    expect(isAllowedReturnUrl(livePartner, 'not a url')).toBe(false)
    expect(isAllowedReturnUrl(livePartner, '//partner.example/cb')).toBe(false)
  })
})
