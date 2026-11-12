import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publicAlternates, publicOrigin } from './public-origin'
import sitemap from '@/app/sitemap'
import robots from '@/app/robots'

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined))
afterEach(() => vi.unstubAllEnvs())
const paths = ['', '/supabase', '/demo', '/x', '/docs/mcp', '/privacy', '/terms', '/refund']

describe('one explicit origin for public metadata', () => {
  it('defaults to the observed final www host, independent of preview host variables', () => {
    vi.stubEnv('VERCEL_URL', 'sample-preview.example.invalid')
    expect(publicOrigin()).toBe('https://www.supalens.ai')
    expect(publicOrigin('  ')).toBe('https://www.supalens.ai')
  })
  it.each(['https://self-host.example.invalid', 'https://self-host.example.invalid/', 'http://localhost:3107/'])('uses an explicit self-hosted origin: %s', value => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value)
    expect(publicOrigin()).toBe(new URL(value).origin)
  })
  it.each(['not-a-url', '//example.invalid', 'javascript:alert(1)', 'file:///tmp/test', 'https://user:PRIVATE@example.invalid', 'https://example.invalid/app', 'https://example.invalid/?token=PRIVATE', 'https://example.invalid/#PRIVATE'])('rejects a non-origin without echoing configuration: %s', value => {
    expect(() => publicOrigin(value)).toThrow('NEXT_PUBLIC_APP_URL must be an absolute HTTP(S) origin')
    try { publicOrigin(value) } catch (error) { expect(String(error)).not.toContain('PRIVATE') }
  })
  for (const origin of ['https://www.supalens.ai', 'https://self-host.example.invalid']) {
    it.each(paths)(`${origin}%s keeps locale paths, canonical and x-default aligned`, path => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', origin)
      for (const locale of ['en', 'ko', 'ja']) {
        const expected = `${origin}${locale === 'en' ? '' : `/${locale}`}${path}`
        const result = publicAlternates(locale, path)
        expect(result.canonical).toBe(expected)
        expect(result.languages).toEqual({ en: origin + path, ko: `${origin}/ko${path}`, ja: `${origin}/ja${path}`, 'x-default': origin + path })
      }
    })
    it(`${origin} is used by actual sitemap and robots exports`, () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', origin)
      const entries = sitemap()
      expect(entries.map(item => item.url)).toEqual(paths.map(path => origin + path))
      for (const [i, item] of entries.entries()) {
        const { 'x-default': ignored, ...languages } = publicAlternates('en', paths[i]).languages
        expect(ignored).toBe(origin + paths[i])
        expect(item.alternates?.languages).toEqual(languages)
      }
      expect(robots()).toMatchObject({ host: origin, sitemap: `${origin}/sitemap.xml` })
      expect(robots().rules).toMatchObject({ disallow: ['/app/', '/api/', '/auth/', '/login', '/share/', '/dev/', '/test/'] })
    })
  }
})
