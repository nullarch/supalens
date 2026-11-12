import { describe, expect, it } from 'vitest'
import { parseKpiRead } from './kpi-read-result'

describe('KPI status read contract', () => {
  it('accepts an explicit empty catalog, not an absent payload', () => {
    expect(parseKpiRead({ extraction: null, kpis: [] })).toEqual({ extractionStatus: null, extractionAt: null, proposed: 0, accepted: 0, stale: 0 })
  })
  for (const status of ['running', 'completed', 'failed']) it(`preserves ${status} and independent catalog totals`, () => {
    expect(parseKpiRead({ extraction: { status, createdAt: '2026-09-08T00:00:00Z' }, kpis: ['proposed', 'proposed', 'accepted', 'stale', 'dismissed'].map(status => ({ status })) }))
      .toEqual({ extractionStatus: status, extractionAt: '2026-09-08T00:00:00Z', proposed: 2, accepted: 1, stale: 1 })
  })
  for (const payload of [null, {}, { kpis: [] }, { extraction: null }, { extraction: null, kpis: [null] }, { extraction: null, kpis: [{ status: 'unknown' }] }, { extraction: { status: 'running', createdAt: 'invalid' }, kpis: [] }, { extraction: { status: 'unknown', createdAt: '2026-09-08T00:00:00Z' }, kpis: [] }]) {
    it(`rejects malformed reads ${JSON.stringify(payload)}`, () => expect(parseKpiRead(payload)).toBeNull())
  }
})
