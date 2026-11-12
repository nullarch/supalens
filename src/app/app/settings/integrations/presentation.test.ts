import { describe, expect, it } from 'vitest'
import { connectionRecovery, integrationReturnNotice, integrationStatus, repoAnalysisResult } from './presentation'

describe('recorded integration states', () => {
  for (const [status, intent] of [['active', 'positive'], ['pending', 'warning'], ['error', 'negative'], ['expired', 'warning'], ['revoked', 'warning'], ['disabled', 'neutral']]) it(`gives ${status} an explicit label and intent`, () => {
    expect(integrationStatus(status)).toEqual({ label: status, intent })
  })
  it('does not display unknown raw records as healthy', () => {
    expect(integrationStatus('unexpected_record_value')).toEqual({ label: 'unknown', intent: 'neutral' })
    expect(connectionRecovery('unexpected_record_value')).toBe('unknown')
  })
  it('does not describe pending setup as a revoked grant', () => {
    expect(connectionRecovery('pending')).toBe('pending')
    expect(connectionRecovery('error')).toBe('error')
    expect(connectionRecovery('revoked')).toBe('reconnect')
    expect(connectionRecovery('expired')).toBe('reconnect')
    expect(connectionRecovery('active')).toBeNull()
  })
})

describe('repository analysis start presentation', () => {
  it('accepts only complete trigger responses', () => {
    expect(repoAnalysisResult({ ok: true, data: { mode: 'trigger', runId: 'run', triggerRunId: 'trigger', publicToken: 'sample' } }).kind).toBe('started')
  })
  for (const data of [null, [], {}, { mode: 'local', runId: 'run' }, { mode: 'trigger', runId: 'run', triggerRunId: '', publicToken: 'sample' }, { mode: 'trigger', runId: 'run', triggerRunId: 'trigger' }]) it('does not subscribe from malformed or wrong-mode success', () => {
    expect(repoAnalysisResult({ ok: true, data })).toEqual({ kind: 'unconfirmed' })
  })
  for (const [error, reason] of [['trigger_required', 'triggerRequired'], ['quota_exceeded', 'quota'], ['forbidden', 'forbidden']]) it(`localizes ${error}`, () => {
    expect(repoAnalysisResult({ ok: false, data: { error } })).toEqual({ kind: 'rejected', reason })
  })
  it('keeps ambiguous server failures unknown and never returns raw text', () => {
    expect(repoAnalysisResult({ ok: false, status: 502, data: { error: 'private detail' } })).toEqual({ kind: 'unconfirmed' })
    expect(repoAnalysisResult({ ok: false, status: 400, data: { error: 'private detail' } })).toEqual({ kind: 'rejected', reason: 'rejected' })
  })
})
describe('connection return notices', () => {
  for (const connected of ['github', 'slack', 'supabase']) it('labels a return without trusting counts or names as stored state', () => {
    const notice = integrationReturnNotice({ connected, projects: 'NaN', repos: '-20', team: 'private-url-text' })
    expect(notice?.kind).toBe('returned')
    expect(JSON.stringify(notice)).not.toMatch(/NaN|-20|private-url-text/)
  })
  for (const connected of [undefined, 'other', ['github']]) it('ignores unrecognized return providers', () => {
    expect(integrationReturnNotice({ connected })).toBeNull()
  })
  for (const skipped of ['NaN', '-1', 'Infinity', '1e3', '9007199254740992', ['2']]) it('does not interpret malformed plan counts as limits', () => {
    expect(integrationReturnNotice({ connecting: 'supabase', skipped })).toMatchObject({ planLimited: false, importing: true })
  })
  it('retains plan review without claiming completed imports', () => {
    expect(integrationReturnNotice({ connecting: 'supabase', skipped: '2' })).toEqual({ kind: 'returned', provider: 'Supabase', importing: true, planLimited: true })
  })
  for (const [error, reason] of [['access_denied', 'cancelled'], ['invalid_state', 'restart'], ['installation_claimed', 'claimed'], ['raw private error', 'failed']]) it('maps errors without exposing raw callback data', () => {
    expect(integrationReturnNotice({ connected: 'github', error })).toEqual({ kind: 'error', reason })
  })
})
