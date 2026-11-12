import { describe, expect, it } from 'vitest'
import { notificationTestResult } from './test-result'

describe('notification test feedback', () => {
  for (const channels of [false, true]) for (const email of [false, true]) {
    it(`preserves independent channel=${channels} / email=${email} reports`, () => {
      expect(notificationTestResult({ ok: true, data: { channels, email } })).toEqual({ channels, email })
    })
  }
  it('does not turn missing, rejected or malformed data into a delivery result', () => {
    for (const value of [null, {}, { ok: false, data: { channels: true, email: true } }, { ok: true }, { ok: true, data: {} }, { ok: true, data: { channels: 'true', email: true } }, { ok: true, data: { channels: false } }]) {
      expect(notificationTestResult(value)).toBeNull()
    }
  })
})
