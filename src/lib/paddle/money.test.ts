import { describe, expect, it } from 'vitest'

import { formatMoney, minorToMajor } from './money'

/**
 * Pin: Paddle amounts are MINOR units. For zero-decimal currencies (KRW/JPY/VND) the
 * minor unit IS the major unit — dividing by 100 displayed a ₩29,000 payment as
 * "290.00" (the prod-facing bug this file pins against).
 */

describe('minorToMajor', () => {
  it('divides by 100 for decimal currencies', () => {
    expect(minorToMajor(2900, 'USD')).toBe(29)
    expect(minorToMajor(2900, 'EUR')).toBe(29)
  })
  it('passes zero-decimal currencies through unchanged', () => {
    expect(minorToMajor(29000, 'KRW')).toBe(29000)
    expect(minorToMajor(500, 'JPY')).toBe(500)
    expect(minorToMajor(29000, 'krw')).toBe(29000) // case-insensitive
  })
  it('defaults to USD semantics when currency is missing', () => {
    expect(minorToMajor(2900, null)).toBe(29)
  })
})

describe('formatMoney', () => {
  it('formats USD cents', () => {
    expect(formatMoney(2900, 'USD', 'en-US')).toBe('$29.00')
  })
  it('formats KRW without the /100 scale-down', () => {
    expect(formatMoney(29000, 'KRW', 'ko-KR')).toBe('₩29,000')
  })
  it('formats JPY without decimals', () => {
    expect(formatMoney(500, 'JPY', 'ja-JP')).toBe('￥500')
  })
  it('renders a dash for missing amounts', () => {
    expect(formatMoney(null, 'USD')).toBe('—')
    expect(formatMoney(undefined, 'KRW')).toBe('—')
  })
  it('treats a missing currency as USD', () => {
    expect(formatMoney(2900, null, 'en-US')).toBe('$29.00')
  })
  it('degrades (not throws) on a malformed currency code', () => {
    expect(() => formatMoney(2900, 'W', 'en-US')).not.toThrow()
    expect(formatMoney(2900, 'W', 'en-US')).toContain('W')
  })
})
