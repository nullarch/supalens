import { describe, expect, it } from 'vitest'
import { monitorActionResult, type MonitorAction } from './action-result'

describe('monitor detail acknowledgements', () => {
  for (const action of ['toggle', 'test', 'delete'] as MonitorAction[]) {
    it(`${action}: requires an explicit outcome and never echoes raw errors`, () => {
      for (const value of [null, undefined, {}, [], { ok: 'true' }, { ok: 1 }]) expect(monitorActionResult(value, action).kind).toBe('unknown')
      expect(monitorActionResult({ ok: false, message: 'private driver detail' }, action)).toEqual({ kind: 'rejected' })
    })
  }
  it('accepts acknowledged pause/delete without requiring test data', () => {
    for (const action of ['toggle', 'delete'] as const) expect(monitorActionResult({ ok: true }, action).kind).toBe('confirmed')
  })
  it('requires both test detail and an actual boolean condition result', () => {
    for (const data of [null, {}, { met: 'false', detail: 'sample' }, { met: true, detail: '' }, { met: false, detail: 42 }]) expect(monitorActionResult({ ok: true, data }, 'test').kind).toBe('unknown')
    for (const met of [true, false]) expect(monitorActionResult({ ok: true, data: { met, detail: 'sample' } }, 'test')).toEqual({ kind: 'tested', met, detail: 'sample' })
  })
})
