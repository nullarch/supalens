import { describe, expect, it } from 'vitest'
import { classifyKpiStart } from './kpi-start-result'

describe('KPI start response contract', () => {
  it('requires the real success acknowledgement', () => {
    expect(classifyKpiStart(200, { ok: true, extractionId: 'sample', tier: 2 })).toEqual({ kind: 'accepted' })
  })
  for (const payload of [null, {}, { ok: true }, { ok: true, extractionId: ' ', tier: 1 }, { ok: true, extractionId: 'sample', tier: 3 }]) {
    it(`does not call malformed success running: ${JSON.stringify(payload)}`, () => expect(classifyKpiStart(200, payload)).toEqual({ kind: 'unknown' }))
  }
  for (const code of ['repo_invalid', 'installation_not_found', 'unknown']) {
    it(`${code} conflict is not an already-running acknowledgement`, () => expect(classifyKpiStart(409, { error: code })).toEqual({ kind: 'rejected', code }))
  }
  it('recognizes the exact already-running and quota contracts', () => {
    expect(classifyKpiStart(409, { error: 'extraction_in_progress' })).toEqual({ kind: 'running' })
    expect(classifyKpiStart(402, { error: 'quota_exceeded' })).toEqual({ kind: 'quota' })
    expect(classifyKpiStart(502, {})).toEqual({ kind: 'unknown' })
    expect(classifyKpiStart(502, { error: 'trigger_failed' })).toEqual({ kind: 'rejected', code: 'trigger_failed' })
  })
})
