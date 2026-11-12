import { describe, expect, it } from 'vitest'
import { resolveDisplayLocale } from './display-locale'

describe('document and support-widget display locale', () => {
  it('uses the supported route even when a different cookie is stored', () => {
    for (const locale of ['en', 'ko', 'ja']) {
      expect(resolveDisplayLocale(locale, 'ko', 'en')).toBe(locale)
    }
  })

  it('uses the display cookie outside locale-routed pages', () => {
    expect(resolveDisplayLocale(undefined, 'ja', 'en')).toBe('ja')
    expect(resolveDisplayLocale(['ko'], 'en', 'ja')).toBe('en')
  })

  it('keeps the server fallback for absent or unsupported cookies', () => {
    for (const cookie of [undefined, '', 'de', '%6a%61', 'constructor']) {
      expect(resolveDisplayLocale(undefined, cookie, 'ko')).toBe('ko')
    }
  })
})
