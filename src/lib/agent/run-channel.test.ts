import { describe, expect, it } from 'vitest'

import { RUN_CHANNELS, channelOf, isMissingColumnError, isRunChannel } from './run-channel'

/**
 * Pins the two contracts the `agent_runs.channel` column depends on:
 *   1. NULL means `web` — historical rows predate the column and must keep rendering.
 *   2. Every reader/writer degrades on 42703 specifically, so the code can ship BEFORE the
 *      migration is applied without breaking run creation or the history page.
 */
describe('channelOf', () => {
  it('reads NULL / undefined / unknown values as web', () => {
    expect(channelOf(null)).toBe('web')
    expect(channelOf(undefined)).toBe('web')
    expect(channelOf('')).toBe('web')
    expect(channelOf('telepathy')).toBe('web')
    expect(channelOf(42)).toBe('web')
  })

  it('passes every declared channel through unchanged', () => {
    for (const c of RUN_CHANNELS) expect(channelOf(c)).toBe(c)
  })

  it('keeps the value set in sync with the migration CHECK', () => {
    expect([...RUN_CHANNELS]).toEqual(['web', 'slack', 'mcp', 'incident', 'digest', 'system', 'monitor'])
  })
})

describe('isRunChannel', () => {
  it('accepts only declared channels', () => {
    expect(isRunChannel('incident')).toBe(true)
    expect(isRunChannel('INCIDENT')).toBe(false)
    expect(isRunChannel(null)).toBe(false)
  })
})

describe('isMissingColumnError', () => {
  it('detects the undefined_column SQLSTATE', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true)
  })

  it('detects the PostgREST schema-cache wording', () => {
    expect(isMissingColumnError({ message: 'column agent_runs.channel does not exist' })).toBe(true)
  })

  it('does NOT swallow unrelated failures — those must still surface', () => {
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingColumnError({ message: 'permission denied for table agent_runs' })).toBe(false)
    expect(isMissingColumnError(null)).toBe(false)
    expect(isMissingColumnError('42703')).toBe(false)
  })
})
