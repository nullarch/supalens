import { describe, expect, it } from 'vitest'

import { stripMentions, pickDefaultSource, isChannelAllowed, type SourceRow } from './answer'

describe('stripMentions', () => {
  it('removes a leading bot mention', () => {
    expect(stripMentions('<@U0BOT123> 어제 매출 얼마야?')).toBe('어제 매출 얼마야?')
  })

  it('removes multiple mentions anywhere in the text', () => {
    expect(stripMentions('<@U1> hey <@U2> what is MRR')).toBe('hey  what is MRR'.trim())
  })

  it('leaves plain text untouched', () => {
    expect(stripMentions('지난주 대비 가입자 추이')).toBe('지난주 대비 가입자 추이')
  })

  it('trims to empty when only a mention is present', () => {
    expect(stripMentions('<@U0BOT123>')).toBe('')
  })
})

describe('pickDefaultSource (demo-exclusion invariant)', () => {
  const demo: SourceRow = { id: 'demo', name: '데모', engine: 'postgres', is_demo: true }
  const real = (id: string, engine = 'postgres'): SourceRow => ({ id, name: id, engine, is_demo: false })

  it('auto-picks the single real source even when the demo source exists', () => {
    // the common production shape: every org has the auto-provisioned demo + one real DB
    expect(pickDefaultSource([demo, real('db1')])).toEqual({ ok: true, id: 'db1', engine: 'postgres' })
  })

  it('falls back to the demo when no real source is connected', () => {
    expect(pickDefaultSource([demo])).toEqual({ ok: true, id: 'demo', engine: 'postgres' })
  })

  it('refuses with a disambiguation message when several REAL sources exist', () => {
    const r = pickDefaultSource([demo, real('a'), real('b')])
    expect(r.ok).toBe(false)
  })

  it('reports no source when the org has none at all', () => {
    const r = pickDefaultSource([])
    expect(r.ok).toBe(false)
  })

  it('propagates the picked source engine (firestore dispatch)', () => {
    expect(pickDefaultSource([demo, real('fs', 'firestore')])).toEqual({ ok: true, id: 'fs', engine: 'firestore' })
  })
})

describe('isChannelAllowed (mention scoping)', () => {
  it('allows any channel when the allowlist is empty (default trust model)', () => {
    expect(isChannelAllowed([], 'C123')).toBe(true)
  })

  it('allows only listed channels when the allowlist is non-empty', () => {
    expect(isChannelAllowed(['C1', 'C2'], 'C2')).toBe(true)
    expect(isChannelAllowed(['C1', 'C2'], 'C9')).toBe(false)
  })
})
