import { describe, expect, it } from 'vitest'

import { isSupportedLocale, parseAcceptLanguage } from './negotiate'

describe('isSupportedLocale', () => {
  it('accepts supported locales', () => {
    expect(isSupportedLocale('en')).toBe(true)
    expect(isSupportedLocale('ko')).toBe(true)
    expect(isSupportedLocale('ja')).toBe(true)
  })

  it('rejects unsupported / empty values', () => {
    expect(isSupportedLocale('fr')).toBe(false)
    expect(isSupportedLocale('ko-KR')).toBe(false)
    expect(isSupportedLocale('')).toBe(false)
    expect(isSupportedLocale(null)).toBe(false)
    expect(isSupportedLocale(undefined)).toBe(false)
  })
})

describe('parseAcceptLanguage', () => {
  it('matches a Korean browser by primary subtag', () => {
    expect(parseAcceptLanguage('ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('ko')
  })

  it('honours q-weight ordering over positional order', () => {
    expect(parseAcceptLanguage('en;q=0.5,ko;q=0.9')).toBe('ko')
  })

  it('falls through unsupported languages to the first supported one', () => {
    expect(parseAcceptLanguage('fr-FR,fr;q=0.9,ja;q=0.4')).toBe('ja')
  })

  it('handles a bare tag with no q-weight', () => {
    expect(parseAcceptLanguage('ja')).toBe('ja')
    expect(parseAcceptLanguage('en-US')).toBe('en')
  })

  it('returns null when nothing matches', () => {
    expect(parseAcceptLanguage('fr-FR,de;q=0.8')).toBeNull()
  })

  it('returns null for empty / missing headers', () => {
    expect(parseAcceptLanguage('')).toBeNull()
    expect(parseAcceptLanguage(null)).toBeNull()
    expect(parseAcceptLanguage(undefined)).toBeNull()
  })

  it('ignores q=0 entries', () => {
    expect(parseAcceptLanguage('ko;q=0,en;q=0.5')).toBe('en')
  })
})
