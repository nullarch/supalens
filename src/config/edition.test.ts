import { afterEach, describe, expect, it, vi } from 'vitest'
import { appOrigin, edition, isCloud, isSelfHosted, parseEdition } from './edition'

afterEach(() => vi.unstubAllEnvs())

describe('edition', () => {
  it('parses the known values and ignores case and whitespace', () => {
    expect(parseEdition('cloud')).toBe('cloud')
    expect(parseEdition(' SelfHost ')).toBe('selfhost')
    expect(parseEdition('self-hosted')).toBe('selfhost')
  })

  it('falls back to the default for unset or unknown values', () => {
    const fallback = parseEdition(undefined)
    expect(parseEdition('')).toBe(fallback)
    expect(parseEdition('enterprise')).toBe(fallback)
  })

  it('reads NEXT_PUBLIC_SUPALENS_EDITION', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'selfhost')
    expect(edition()).toBe('selfhost')
    expect(isSelfHosted()).toBe(true)
    expect(isCloud()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'cloud')
    expect(isCloud()).toBe(true)
  })
})

describe('appOrigin', () => {
  it('prefers NEXT_PUBLIC_APP_URL and strips trailing slashes', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://bi.example.com/')
    expect(appOrigin()).toBe('https://bi.example.com')
  })

  it('falls back to the hosted domain only in the cloud edition', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'cloud')
    expect(appOrigin()).toBe('https://supalens.ai')
    expect(appOrigin('https://www.supalens.ai')).toBe('https://www.supalens.ai')
  })

  it('never points a self-hosted install at the hosted domain', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'selfhost')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(appOrigin()).toBe('http://localhost:3000')
    expect(appOrigin('https://www.supalens.ai')).toBe('http://localhost:3000')
    warn.mockRestore()
  })
})
