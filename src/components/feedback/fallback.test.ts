import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FALLBACK_COPY, fallbackHome, fallbackLocale } from './fallback-copy'
import { FALLBACK_CSS } from './fallback-style'

describe('provider-independent root fallback', () => {
  it.each([
    ['/ko/docs', 'NEXT_LOCALE=ja', 'ko'], ['/ja', 'NEXT_LOCALE=en', 'ja'],
    ['/en', 'NEXT_LOCALE=ko', 'en'], ['/app/overview', 'other=x; NEXT_LOCALE=ko; rest=y', 'ko'],
    ['/login', 'NEXT_LOCALE=ja', 'ja'], ['/app', 'NEXT_LOCALE=unknown', 'en'],
    ['/unknown', '', 'en'], ['/koevil', 'NEXT_LOCALE=ja', 'ja'],
    ['/app', 'notNEXT_LOCALE=ja', 'en'], ['/app', 'NEXT_LOCALE=%3Cscript%3E', 'en'],
  ])('resolves route/cookie safely: %s %s', (path, cookie, expected) => {
    expect(fallbackLocale(path, cookie)).toBe(expected)
  })
  it.each(['en', 'ko', 'ja'] as const)('supplies complete copy and a local home for %s', locale => {
    expect(Object.values(FALLBACK_COPY[locale]).every(value => value.length > 0)).toBe(true)
    expect(fallbackHome(locale)).toBe(locale === 'en' ? '/' : `/${locale}`)
  })
  it('mirrors the approved light/dark tokens without needing the root stylesheet', () => {
    const global = readFileSync('src/app/globals.css', 'utf8')
    for (const [selector, globalSelector] of [['.sl-root-fallback {', ':root {'], ['.sl-root-fallback[data-fallback-theme="dark"] {', '[data-theme="dark"] {']]) {
      const block = FALLBACK_CSS.slice(FALLBACK_CSS.indexOf(selector)).split('}')[0]
      const globalBlock = global.slice(global.indexOf(globalSelector)).split('}')[0]
      const tokens = [...block.matchAll(/(--[\w-]+): (#[\da-f]{6})/g)]
      expect(tokens).toHaveLength(10)
      for (const [, key, value] of tokens) expect(globalBlock.toLowerCase()).toContain(`${key === '--clay' ? '--brand' : key}: ${value}`)
      expect(global).toContain('--clay: var(--brand)')
    }
  })
  it('keeps the root UI independent of failed providers and does not show exception details', () => {
    for (const file of ['src/app/global-error.tsx', 'src/components/feedback/RootErrorContent.tsx', 'src/components/feedback/FallbackSurface.tsx', 'src/components/feedback/fallback-copy.ts']) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/from ['"](?:next-intl|next\/navigation|@\/utils\/supabase)/)
      expect(source).not.toMatch(/error\.(message|stack|digest)/)
    }
  })
  it('aligns the existing SVG favicon colors without changing its three-circle mark', () => {
    const svg = readFileSync('src/app/icon.svg', 'utf8')
    expect(svg.match(/<circle /g)).toHaveLength(3)
    for (const hex of ['#191c20', '#b94d32', '#eeeff1', '#f08a65']) expect(svg).toContain(hex)
    for (const shape of ['rounded', 'square']) {
      const source = readFileSync(`scripts/brand/icon-tile-${shape}.svg`, 'utf8')
      expect(source.match(/<circle /g)).toHaveLength(3)
      for (const hex of ['#fbfcfc', '#191c20', '#b94d32']) expect(source).toContain(hex)
      expect(source).not.toContain('<path')
    }
  })
  it('emits a 180px Apple PNG and both required PNG-in-ICO sizes', () => {
    const png = readFileSync('src/app/apple-icon.png')
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180])
    const ico = readFileSync('src/app/favicon.ico')
    expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0])
    for (const [index, size] of [16, 32].entries()) {
      const entry = 6 + index * 16, offset = ico.readUInt32LE(entry + 12), length = ico.readUInt32LE(entry + 8)
      expect(offset + length).toBeLessThanOrEqual(ico.length)
      expect([...ico.subarray(offset, offset + 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect([ico.readUInt32BE(offset + 16), ico.readUInt32BE(offset + 20)]).toEqual([size, size])
    }
  })
})

describe('complete route loading coverage', () => {
  const directory = 'src/app/app'
  const files = readdirSync(directory, { recursive: true }).filter(file => typeof file === 'string' && file.endsWith('loading.tsx')) as string[]
  it('finds every current loading route, not a selected shortlist', () => { expect(files.length).toBe(23) })
  it.each(files)('%s uses the common localized announcement', file => {
    const source = readFileSync(`${directory}/${file}`, 'utf8')
    expect(source).toContain('<LoadingFrame')
    expect(source).toContain('</LoadingFrame>')
    expect(source).not.toContain('aria-busy="true"')
  })
})
