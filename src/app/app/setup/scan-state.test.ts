import { describe, expect, it } from 'vitest'
import { INITIAL_PROGRESS } from '@/lib/bootstrap/events'
import { scanFailed, scanReady, scanGate, type ScanStatus } from './scan-state'

describe('scan presentation state', () => {
  const initial: ScanStatus = { ...INITIAL_PROGRESS, active: false, resumeFrom: 'schema' }
  it('does not infer completion from initial or active state', () => {
    expect(scanReady(initial)).toBe(false)
    const done = { ...initial, phases: { ...initial.phases, kpi: 'done' as const } }
    expect(scanReady(done)).toBe(true)
    expect(scanReady({ ...done, active: true })).toBe(false)
    const failed = { ...done, phases: { ...done.phases, context: 'failed' as const } }
    expect(scanFailed(failed)).toBe(true)
    expect(scanReady(failed)).toBe(false)
  })
  it('only a scan-in-progress conflict represents an existing run', () => {
    expect(scanGate(409, 'scan_in_progress')).toBe('conflict')
    expect(scanGate(409, 'repo_invalid')).toBe('repository')
    expect(scanGate(409, 'installation_not_found')).toBe('repository')
    expect(scanGate(409, 'unexpected')).toBe('failed')
  })
  it('distinguishes quota, plan and permission gates', () => {
    expect(scanGate(402, 'context_limit')).toBe('limit')
    expect(scanGate(402, 'quota_exceeded')).toBe('quota')
    expect(scanGate(401)).toBe('permission')
    expect(scanGate(403)).toBe('permission')
    expect(scanGate(503, 'trigger_required')).toBe('failed')
  })
})
