import { describe, expect, it } from 'vitest'
import { isRevoked, keyLastUsed, readKeyList, readMintedToken } from './key-response'

const key = { id: 'sample', prefix: 'sl_example', lastFour: 'demo', scopes: ['read'], createdAt: '2026-09-01T00:00:00Z', lastUsedAt: null, revokedAt: null }

describe('MCP key presentation responses', () => {
  it('accepts only complete lists and retains an explicit empty list', () => {
    expect(readKeyList({ keys: [key] })).toEqual([key])
    expect(readKeyList({ keys: [] })).toEqual([])
    for (const value of [null, {}, [], { error: 'forbidden' }, { keys: null }, { keys: [key, key] }, { keys: [{ ...key, scopes: null }] }, { keys: [{ ...key, lastUsedAt: 123 }] }]) expect(readKeyList(value)).toBeNull()
  })
  it('requires a nonempty string secret and literal revoke acknowledgement', () => {
    expect(readMintedToken({ token: 'sample-only' })).toBe('sample-only')
    for (const token of [null, '', '  ', 42, true, {}]) expect(readMintedToken({ token })).toBeNull()
    expect(isRevoked({ revoked: true })).toBe(true)
    for (const value of [{ revoked: false }, { revoked: 'true' }, {}, null]) expect(isRevoked(value)).toBe(false)
  })
  it('formats recorded dates in explicit UTC and does not invent missing dates', () => {
    for (const locale of ['en-US', 'ko-KR', 'ja-JP']) {
      expect(keyLastUsed('2026-09-01T00:00:00Z', locale)).toContain('UTC')
      expect(keyLastUsed('invalid', locale)).toBeNull()
      expect(keyLastUsed(null, locale)).toBeNull()
    }
  })
})
