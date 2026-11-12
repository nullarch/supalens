import { describe, expect, it } from 'vitest'

import { ALERT_ERROR_CODES } from '@/lib/alerts/error-codes'
import { isLabelledAlertErrorCode, RAW_ERROR_MAX, truncateError } from './last-error'

describe('isLabelledAlertErrorCode', () => {
  it('accepts every runner code EXCEPT reconnect_required, which has its own banner', () => {
    for (const code of ALERT_ERROR_CODES) {
      expect(isLabelledAlertErrorCode(code)).toBe(code !== 'reconnect_required')
    }
  })

  it('rejects raw driver text — that path renders under the generic "Check failed:" label', () => {
    expect(isLabelledAlertErrorCode('relation "orders" does not exist')).toBe(false)
    expect(isLabelledAlertErrorCode('')).toBe(false)
    expect(isLabelledAlertErrorCode(null)).toBe(false)
    expect(isLabelledAlertErrorCode(undefined)).toBe(false)
  })

  it('every labelled code must exist in the catalog under appMonitors.errors.*', async () => {
    // guards the MISSING_MESSAGE crash: a new runner code with no copy would throw at render time
    const en = (await import('../../../../messages/en.json')).default as {
      appMonitors: { errors: Record<string, string> }
    }
    for (const code of ALERT_ERROR_CODES) {
      if (!isLabelledAlertErrorCode(code)) continue
      expect(en.appMonitors.errors[code], `missing appMonitors.errors.${code}`).toBeTruthy()
    }
  })
})

describe('truncateError', () => {
  it('collapses whitespace so a multi-line stack stays one row', () => {
    expect(truncateError('syntax error\n  at line 3\t— near "form"')).toBe('syntax error at line 3 — near "form"')
  })

  it('clips long text and marks the clip', () => {
    const long = 'x'.repeat(RAW_ERROR_MAX + 50)
    const out = truncateError(long)
    expect(out).toHaveLength(RAW_ERROR_MAX)
    expect(out.endsWith('…')).toBe(true)
  })

  it('leaves a short message untouched', () => {
    expect(truncateError('timeout')).toBe('timeout')
  })
})
