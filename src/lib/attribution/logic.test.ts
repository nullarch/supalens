import { describe, expect, it } from 'vitest'

import { isRefCode } from './logic'

describe('isRefCode', () => {
  it('accepts generated codes', () => {
    expect(isRefCode('9ThavzGO')).toBe(true)
    expect(isRefCode('PZLcHzhW')).toBe(true)
  })
  it('rejects anything that is not 6–16 base62 characters', () => {
    expect(isRefCode('')).toBe(false)
    expect(isRefCode('short')).toBe(false)
    expect(isRefCode('has space')).toBe(false)
    expect(isRefCode('drop--table')).toBe(false)
    expect(isRefCode('../../etc')).toBe(false)
    expect(isRefCode('a'.repeat(17))).toBe(false)
  })
})
