import { describe, expect, it } from 'vitest'

import { ALERT_ERROR_CODES, isAlertErrorCode } from './error-codes'
import { RECONNECT_REQUIRED } from '@/lib/supabase-oauth/errors'

/**
 * Pins the contract that makes `alerts.last_error` renderable in a localized UI: what the product
 * writes there is a CODE from this set, never a sentence. The live defects this replaced were the
 * runner's English literals ("metric query returned no numeric scalar", …) and a hardcoded KOREAN
 * string in data-sources/cleanup.ts, all of which reached the monitors screen verbatim.
 */

describe('ALERT_ERROR_CODES', () => {
  it('are snake_case identifiers, not prose (nothing renderable-as-is leaks in)', () => {
    for (const code of ALERT_ERROR_CODES) {
      expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/)
      expect(code).not.toContain(' ')
    }
  })

  it('carries the OAuth reconnect code produced by supabase-oauth/errors.ts', () => {
    // The two modules must agree: persistableError writes RECONNECT_REQUIRED into the same
    // column the UI branches on with isAlertErrorCode.
    expect(ALERT_ERROR_CODES).toContain(RECONNECT_REQUIRED)
    expect(isAlertErrorCode(RECONNECT_REQUIRED)).toBe(true)
  })

  it('has no duplicates', () => {
    expect(new Set(ALERT_ERROR_CODES).size).toBe(ALERT_ERROR_CODES.length)
  })
})

describe('isAlertErrorCode', () => {
  it('is true for every member', () => {
    for (const code of ALERT_ERROR_CODES) expect(isAlertErrorCode(code)).toBe(true)
  })

  it('is false for a raw driver message — which the renderer must show VERBATIM, not translate', () => {
    // Query faults deliberately keep their own text (persistableError passes them through): that
    // string is the diagnostic. isAlertErrorCode is exactly the branch that tells them apart.
    expect(isAlertErrorCode('relation "orders" does not exist')).toBe(false)
    expect(isAlertErrorCode('canceling statement due to statement timeout')).toBe(false)
    expect(isAlertErrorCode('데이터 소스가 삭제되어 비활성화되었습니다')).toBe(false)
  })

  it('rejects non-strings and near-misses', () => {
    for (const v of [null, undefined, 0, {}, [], 'No_Scalar', 'no scalar']) {
      expect(isAlertErrorCode(v)).toBe(false)
    }
  })
})
