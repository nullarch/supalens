import { describe, expect, it } from 'vitest'
import { runActionAcknowledgement, shareCreationResult, stopActionResult } from './run-action-result'

describe('analysis action acknowledgements', () => {
  it.each([undefined, null, true, 'ok', {}, { ok: 'true' }, { ok: 1 }])('keeps %j unknown', value => {
    expect(runActionAcknowledgement(value)).toBe('unknown')
  })
  it('accepts only actual booleans', () => {
    expect(runActionAcknowledgement({ ok: true })).toBe('confirmed')
    expect(runActionAcknowledgement({ ok: false })).toBe('rejected')
  })
  it.each(['https://supalens.ai/share/abc123', 'https://custom.example/share/a-b_c', 'http://localhost:3107/share/abc'])('preserves supported deployment URL %s', url => {
    expect(shareCreationResult({ ok: true, url })).toEqual({ kind: 'confirmed', url })
  })
  it.each([undefined, '', 'javascript:alert(1)', '/share/abc', 'https://a.test/account', 'https://a.test/share/',
    'https://user:pass@a.test/share/abc', 'https://a.test/share/abc?secret=x', 'https://a.test/share/abc#x',
    'https://a.test/share/a%2Fb', ' https://a.test/share/abc'])('does not expose malformed public URL %j', url => {
    expect(shareCreationResult({ ok: true, url })).toEqual({ kind: 'unknown' })
  })
  it('preserves rejection without exposing returned values', () => {
    expect(shareCreationResult({ ok: false, url: 'https://a.test/share/abc', error: 'private' })).toEqual({ kind: 'rejected' })
  })
})

describe('stop response contract', () => {
  it.each([[401, 'unauthorized'], [404, 'not_found'], [500, 'supabase_not_configured']] as const)('recognizes pre-write rejection %s/%s', (status, error) => {
    expect(stopActionResult(status, { error })).toBe('rejected')
  })
  it('distinguishes accepted intent from a reported terminal run', () => {
    expect(stopActionResult(200, { ok: true, status: 'cancelled' })).toBe('requested')
    expect(stopActionResult(200, { ok: true, status: 'succeeded' })).toBe('terminal')
    expect(stopActionResult(200, { ok: true, status: 'failed' })).toBe('terminal')
  })
  it.each([
    [200, null], [200, {}], [200, { ok: 'true', status: 'cancelled' }], [200, { ok: true, status: 'running' }],
    [200, { ok: true, status: 'invented' }], [503, { ok: true, status: 'cancelled' }],
    [403, { error: 'private' }], [500, { error: 'unknown' }], [200, { error: 'unauthorized' }],
  ])('does not claim a stop from %s/%j', (status, value) => {
    expect(stopActionResult(status as number, value)).toBe('unknown')
  })
})
