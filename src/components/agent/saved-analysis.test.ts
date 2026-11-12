import { describe, expect, it } from 'vitest'
import { elapsedMs, groupHistory, isStatSpec, statusKey, type HistoryRun } from './saved-analysis'

const row = (patch: Partial<HistoryRun> = {}): HistoryRun => ({ id: 'run', question: 'Question', status: 'succeeded', created_at: '2026-09-07T12:00:00Z', ended_at: '2026-09-07T12:00:01Z', user_id: 'user', data_source_id: 'source', channel: 'web', data_sources: { name: 'Source' }, ...patch })
describe('saved analysis presentation', () => {
  it('groups adjacent source/actor/channel runs through the 30-minute boundary', () => {
    expect(groupHistory([row(), row({ created_at: '2026-09-07T11:30:00Z' })])).toHaveLength(1)
    expect(groupHistory([row(), row({ created_at: '2026-09-07T11:29:59Z' })])).toHaveLength(2)
  })
  it('keeps actors, sources and channels distinct', () => {
    for (const patch of [{ user_id: 'other' }, { data_source_id: 'other' }, { channel: 'slack' }]) expect(groupHistory([row(), row(patch)])).toHaveLength(2)
  })
  it('never groups two incident explanations', () => {
    expect(groupHistory([row({ channel: 'incident' }), row({ channel: 'incident' })])).toHaveLength(2)
  })
  it('does not group invalid or reverse-ordered timestamps', () => {
    for (const created_at of ['invalid', '2026-09-07T13:00:00Z']) expect(groupHistory([row(), row({ created_at })])).toHaveLength(2)
  })
  it('preserves the existing legacy origin normalization', () => {
    expect(groupHistory([row({ channel: null }), row({ channel: 'unknown' })])[0].origin).toBe('web')
  })
  it('distinguishes zero duration, unknown and invalid elapsed time', () => {
    expect(elapsedMs(row())).toBe(1000)
    expect(elapsedMs(row({ ended_at: '2026-09-07T12:00:00Z' }))).toBe(0)
    for (const ended_at of [null, 'invalid', '2026-09-07T11:00:00Z']) expect(elapsedMs(row({ ended_at }))).toBeNull()
  })
  it('does not label an unknown saved status as successful', () => {
    expect(statusKey('succeeded')).toBe('succeeded')
    expect(statusKey('not-a-status')).toBe('unknown')
  })
  it('splits both envelope and bare chart specs without assuming a valid object', () => {
    for (const spec of [{ type: 'kpi' }, { chart: { type: 'bignumber' } }]) expect(isStatSpec(spec)).toBe(true)
    for (const spec of [null, undefined, 1, {}, { type: 'line' }]) expect(isStatSpec(spec)).toBe(false)
  })
})
