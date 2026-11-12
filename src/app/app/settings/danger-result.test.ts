import { describe, expect, it } from 'vitest'
import { dangerResult } from './danger-result'

const known = { notOwner: 'owner only', subscription: 'paid plan', otherMembers: 'transfer first', teardown: 'cleanup failed', finalStep: 'auth deletion failed' }
describe('destructive action feedback', () => {
  it('accepts an explicit acknowledgement, without certifying external cleanup', () => {
    expect(dangerResult({ ok: true, data: undefined }, known)).toEqual({ kind: 'confirmed' })
  })
  for (const value of [null, undefined, [], {}, { ok: 'true' }, { ok: false }, { ok: false, message: 'private database detail' }, { ok: false, message: 42 }]) it('does not treat malformed/generic failure as proof that nothing happened', () => {
    expect(dangerResult(value, known)).toEqual({ kind: 'unknown' })
  })
  for (const reason of ['unconfigured', 'unauthorized']) it(`recognizes preflight ${reason}`, () => {
    expect(dangerResult({ ok: false, reason }, known)).toEqual({ kind: 'blocked', reason })
  })
  for (const reason of ['notOwner', 'subscription', 'otherMembers'] as const) it(`allows only a known ${reason} rejection`, () => {
    expect(dangerResult({ ok: false, message: known[reason] }, known)).toEqual({ kind: 'blocked', reason })
  })
  for (const stage of ['teardown', 'finalStep'] as const) it(`preserves ${stage} partial-outcome semantics`, () => {
    expect(dangerResult({ ok: false, message: known[stage] }, known)).toEqual({ kind: 'partial', stage })
  })
  it('does not classify a rejection from a different operation or missing message', () => {
    expect(dangerResult({ ok: false, message: known.otherMembers }, { subscription: known.subscription })).toEqual({ kind: 'unknown' })
    expect(dangerResult({ ok: false, message: '' }, {})).toEqual({ kind: 'unknown' })
  })
})
