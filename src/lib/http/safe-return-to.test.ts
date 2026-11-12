import { describe, expect, it } from 'vitest'

import { isSafeReturnTo } from './safe-return-to'

describe('isSafeReturnTo (open-redirect guard)', () => {
  it('accepts same-origin path-only targets', () => {
    expect(isSafeReturnTo('/app/settings/integrations')).toBe(true)
    expect(isSafeReturnTo('/')).toBe(true)
  })

  it('rejects protocol-relative and backslash off-origin forms', () => {
    expect(isSafeReturnTo('//evil.com')).toBe(false)
    expect(isSafeReturnTo('/\\evil.com')).toBe(false)
    expect(isSafeReturnTo('https://evil.com')).toBe(false)
  })

  it('rejects non-path and empty values', () => {
    expect(isSafeReturnTo(null)).toBe(false)
    expect(isSafeReturnTo(undefined)).toBe(false)
    expect(isSafeReturnTo('')).toBe(false)
    expect(isSafeReturnTo('app/relative')).toBe(false)
  })
})
