import { describe, expect, it } from 'vitest'
import { contextTimestamp, generationOutcome } from './presentation'

describe('business context evidence', () => {
  it('separates inline completion from an accepted background job', () => {
    expect(generationOutcome(true, { ok: true, tier: 1 })).toBe('completed')
    expect(generationOutcome(true, { ok: true, tier: 2, triggerRunId: 'sample' })).toBe('started')
  })
  it('does not claim success for malformed or incomplete replies', () => {
    for (const body of [null, [], {}, { ok: false, tier: 1 }, { ok: true, tier: 2 }, { ok: true, tier: 2, triggerRunId: ' ' }]) {
      expect(generationOutcome(true, body)).toBe('generic')
    }
    expect(generationOutcome(false, { ok: true, tier: 1 })).toBe('generic')
  })
  it('keeps limits, existing runs and generic errors distinct', () => {
    expect(generationOutcome(false, { error: 'context_limit' })).toBe('limit')
    expect(generationOutcome(false, { error: 'quota_exceeded' })).toBe('quota')
    expect(generationOutcome(false, { error: 'generation_in_progress' })).toBe('running')
    expect(generationOutcome(false, { error: 'forbidden' })).toBe('generic')
  })
  it('shows a recorded zone, never invented freshness', () => {
    for (const locale of ['en', 'ko', 'ja']) {
      expect(contextTimestamp('2026-09-07T12:00:00Z', locale)?.label).toContain('UTC')
      expect(contextTimestamp('2099-01-01T00:00:00Z', locale)?.iso).toBe('2099-01-01T00:00:00.000Z')
    }
    expect(contextTimestamp('invalid', 'en')).toBeNull()
    expect(contextTimestamp(null, 'en')).toBeNull()
  })
})
