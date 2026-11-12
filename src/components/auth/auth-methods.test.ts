import { afterEach, describe, expect, it, vi } from 'vitest'
import { enabledAuthMethods, parseAuthMethods } from './auth-methods'

afterEach(() => vi.unstubAllEnvs())

describe('auth methods', () => {
  it('keeps known methods in display order and drops unknown ones', () => {
    expect(parseAuthMethods('password, GitHub,saml,google', ['email_link'])).toEqual(['google', 'github', 'password'])
  })

  it('falls back when nothing valid is listed', () => {
    expect(parseAuthMethods('', ['password'])).toEqual(['password'])
    expect(parseAuthMethods('saml', ['password'])).toEqual(['password'])
  })

  it('defaults to social + email link on the hosted edition', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', '')
    vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'cloud')
    expect(enabledAuthMethods()).toEqual(['google', 'kakao', 'github', 'email_link'])
  })

  it('is password only on a self-hosted install, even when social providers are listed', () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDERS', 'google,github,email_link')
    vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'selfhost')
    expect(enabledAuthMethods()).toEqual(['password'])
  })
})
