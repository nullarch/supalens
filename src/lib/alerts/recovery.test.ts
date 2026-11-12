import { describe, expect, it } from 'vitest'
import { authorizationAwaitingCheck, checkedRecoveryResult, isRecoveryId, recoveryAuthorizeHref, recoveryBatch, recoveryGroups, recoveryKind, recoveryReturn, recoveryScope, type RecoveryMonitor } from './recovery'

const monitor: RecoveryMonitor = { id: 'a', name: 'Sample', enabled: true, dataSourceId: 'source', dataSourceName: 'Sample source', lastError: 'reconnect_required', connectionId: 'connection-a' }
describe('guided recovery contracts', () => {
  const restored = { ...monitor, connectionStatus: 'active', connectionRefreshedAt: '2026-09-08T08:00:00Z', lastCheckedAt: '2026-09-08T07:00:00Z' }
  it('offers verification after a persisted authorization update, including after navigation', () => {
    expect(authorizationAwaitingCheck(restored)).toBe(true)
    expect(recoveryScope([restored])).not.toBe(recoveryScope([monitor]))
  })
  it.each([{ connectionStatus: 'revoked' }, { connectionId: null }, { connectionRefreshedAt: null }, { connectionRefreshedAt: 'bad' }, { lastCheckedAt: null }, { lastCheckedAt: '2026-09-08T09:00:00Z' }, { lastCheckedAt: '2026-09-08T08:00:00Z' }, { lastError: 'no_scalar' }])('does not hide an unresolved or newer authorization failure', patch => expect(authorizationAwaitingCheck({ ...restored, ...patch })).toBe(false))
  it('invalidates local results when definition or recorded execution changes', () => {
    const initial = recoveryScope([monitor])
    for (const patch of [{ threshold: 9 }, { metricSql: 'SELECT 9' }, { lastCheckedAt: '2026-09-08T00:00:00Z' }, { enabled: false }, { lastError: 'no_scalar' }, { dataSourceId: 'other' }]) expect(recoveryScope([{ ...monitor, ...patch }])).not.toBe(initial)
    expect(recoveryScope([{ ...monitor }])).toBe(initial)
  })
  it('bounds batches, prioritizes unchecked monitors, and excludes paused/verified items', () => {
    const monitors = Array.from({ length: 8 }, (_, i) => ({ ...monitor, id: String(i), enabled: i !== 7 }))
    expect(recoveryBatch(monitors, {}).map(m => m.id)).toEqual(['0', '1', '2', '3', '4'])
    expect(recoveryBatch(monitors, { '0': { ok: false, reason: 'authorization' }, '1': { ok: true, value: 0, conditionMet: false, checkedAt: '2026-09-08' } }).map(m => m.id)).toEqual(['2', '3', '4', '5', '6'])
  })
  it.each([['reconnect_required', 'authorization'], ['no_scalar', 'scalar'], ['series_too_long', 'seriesLong'], ['series_too_short', 'seriesShort'], ['source_removed', 'sourceRemoved'], ['connection failed: authentication timeout', 'unknown'], [null, null], ['', null]])('maps only known codes: %s', (input, expected) => expect(recoveryKind(input)).toBe(expected))
  it('groups only known shared connection identities, never names or raw text', () => {
    const groups = recoveryGroups([monitor, { ...monitor, id: 'b', enabled: false }, { ...monitor, id: 'c', connectionId: 'connection-b' }, { ...monitor, id: 'd', connectionId: null }, { ...monitor, id: 'e', connectionId: null }, { ...monitor, id: 'f', lastError: 'no_scalar' }, { ...monitor, id: 'g', lastError: null }])
    expect(groups.map(group => group.monitors.map(m => m.id))).toEqual([['a', 'b'], ['c'], ['d'], ['e'], ['f']])
  })
  it.each([undefined, null, {}, { ok: true }, { ok: true, value: NaN, checkedAt: '2026-09-08', conditionMet: false }, { ok: true, value: 1, checkedAt: 'bad date', conditionMet: false }, { ok: false, reason: 'PRIVATE_SECRET' }])('does not trust malformed responses', value => expect(checkedRecoveryResult(value)).toEqual({ ok: false, reason: 'unconfirmed' }))
  it('preserves condition matches separately from verified execution', () => {
    const value = { ok: true, value: 3, conditionMet: true, checkedAt: '2026-09-08T00:00:00Z' }
    expect(checkedRecoveryResult(value)).toEqual(value)
  })
  it('builds a same-origin targeted OAuth handoff', () => {
    const url = new URL(recoveryAuthorizeHref('connection-a', 'a/b'), 'https://sample.invalid')
    expect(url.pathname).toBe('/api/connect-supabase/authorize')
    expect(url.searchParams.get('connectionId')).toBe('connection-a')
    expect(url.searchParams.get('returnTo')).toBe('/app/monitors/a%2Fb')
  })
  it('accepts UUID targets, not paths or missing IDs', () => {
    expect(isRecoveryId('00000000-0000-4000-8000-000000000001')).toBe(true)
    expect(isRecoveryId('../other')).toBe(false)
    expect(isRecoveryId(null)).toBe(false)
  })
  it('allowlists callback notices without interpreting them as evidence', () => {
    expect(recoveryReturn('authorized')).toBe('authorized')
    expect(recoveryReturn('PRIVATE_PROVIDER_ERROR')).toBe(null)
    expect(recoveryReturn(['authorized'])).toBe(null)
  })
})
