import { describe, expect, it } from 'vitest'
import { parseAnalysisStart } from './analysis-start'

describe('analysis start response', () => {
  it('captures the selected source and prior turns for local transport', () => {
    expect(parseAnalysisStart({ mode: 'local', runId: 'run' }, 'source', ['previous'])).toEqual({ runId: 'run', run: { mode: 'local', runId: 'run', dataSourceId: 'source', priorRunIds: ['previous'] } })
  })
  it('accepts only complete run-scoped Trigger credentials', () => {
    expect(parseAnalysisStart({ mode: 'trigger', runId: 'run', triggerRunId: 'trigger', publicToken: 'token' }, 'source', [])?.run.mode).toBe('trigger')
    for (const patch of [{ publicToken: '' }, { triggerRunId: '' }, { publicToken: null }]) expect(parseAnalysisStart({ mode: 'trigger', runId: 'run', triggerRunId: 'trigger', publicToken: 'token', ...patch }, 'source', [])).toBeNull()
  })
  it('rejects missing, blank, malformed and unknown-mode responses', () => {
    for (const value of [null, [], {}, 'ok', { mode: 'local' }, { mode: 'local', runId: ' ' }, { mode: 'other', runId: 'run' }]) expect(parseAnalysisStart(value, 'source', [])).toBeNull()
  })
})
