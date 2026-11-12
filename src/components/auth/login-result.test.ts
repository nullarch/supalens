import { describe, expect, it } from 'vitest'
import { loginResult } from './login-result'

describe('login SDK acknowledgement', () => {
  it('does not equate an email request acknowledgement with a session', () => {
    expect(loginResult({ error: null, data: { user: null, session: null } }, 'email')).toBe('acknowledged')
  })
  it('requires a matching provider and a navigable URL', () => {
    expect(loginResult({ error: null, data: { provider: 'google', url: 'https://auth.example.invalid/authorize' } }, 'google')).toBe('acknowledged')
    expect(loginResult({ error: null, data: { provider: 'github', url: 'https://auth.example.invalid/authorize' } }, 'google')).toBe('unknown')
  })
  it.each(['', 'invalid', 'javascript:alert(1)', 'data:text/html,hello', 'http://external.example.invalid'])('rejects an invalid returned OAuth URL: %s', url => {
    expect(loginResult({ error: null, data: { provider: 'google', url } }, 'google')).toBe('unknown')
  })
  it('allows the existing local HTTP auth setup', () => {
    expect(loginResult({ error: null, data: { provider: 'github', url: 'http://127.0.0.1:54321/auth/v1/authorize' } }, 'github')).toBe('acknowledged')
  })
  it.each([undefined, null, {}, { error: null }, { error: false, data: {} }, { error: null, data: {} }, { error: null, data: { user: 'bad', session: 'bad' } }, { error: { message: 'private raw error' } }])('does not infer success from malformed/generic results', value => {
    expect(loginResult(value, 'email')).toBe('unknown')
  })
  it.each([
    ['over_email_send_rate_limit', 'rateLimited'], ['over_request_rate_limit', 'rateLimited'],
    ['email_address_invalid', 'invalidRequest'], ['validation_failed', 'invalidRequest'],
    ['provider_disabled', 'unavailable'], ['email_provider_disabled', 'unavailable'],
  ])('maps only known error code %s', (code, expected) => {
    expect(loginResult({ error: { code, message: 'private raw error' } }, 'email')).toBe(expected)
  })
})
