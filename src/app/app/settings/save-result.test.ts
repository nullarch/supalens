import { describe, expect, it } from 'vitest'
import { settingsSaveResult } from './save-result'

describe('settings save evidence', () => {
  it('requires an explicit boolean acknowledgement', () => {
    expect(settingsSaveResult({ ok: true, data: undefined }).kind).toBe('confirmed')
    for (const value of [undefined, null, [], 'ok', {}, { ok: 1 }, { ok: 'true' }]) expect(settingsSaveResult(value).kind).toBe('unconfirmed')
  })
  it('keeps returned errors and missing-message fallbacks distinct from lost responses', () => {
    expect(settingsSaveResult({ ok: false, reason: 'unauthorized' })).toEqual({ kind: 'rejected', message: undefined })
    expect(settingsSaveResult({ ok: false, message: 'Permission denied' })).toEqual({ kind: 'rejected', message: 'Permission denied' })
    expect(settingsSaveResult({ ok: false, message: ' ' }).message).toBeUndefined()
  })
  it('recognizes only the existing localized migration-error shape as informational', () => {
    expect(settingsSaveResult({ ok: false, reason: 'error', message: 'Not live yet' }, 'Not live yet').kind).toBe('migration')
    expect(settingsSaveResult({ ok: false, message: 'Not live yet' }, 'Not live yet').kind).toBe('rejected')
    expect(settingsSaveResult({ ok: false, reason: 'error', message: 'Other error' }, 'Not live yet').kind).toBe('rejected')
  })
})
