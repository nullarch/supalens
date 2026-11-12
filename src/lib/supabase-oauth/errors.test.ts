import { describe, expect, it } from 'vitest'

import {
  RECONNECT_REQUIRED,
  isConnectionErrorCode,
  isReconnectRequiredError,
  persistableError,
} from './errors'
import { ReconnectRequiredError, isReconnectRequired } from './tokens'

/**
 * Pins the boundary that produced a live bug: the raw text
 *   "Supabase connection 11111111-… requires reconnect (revoked)."
 * reached `alerts.last_error` and was rendered verbatim on /app/monitors. These tests hold the
 * two halves of the fix — the fault is recognized by NAME (not message), and what gets persisted
 * is a stable code, never the exception text.
 */

const REAL = new ReconnectRequiredError('11111111-2222-4333-8444-555555555555', 'revoked')

describe('isReconnectRequired / isReconnectRequiredError', () => {
  it('recognizes the real error', () => {
    expect(isReconnectRequired(REAL)).toBe(true)
    expect(isReconnectRequiredError(REAL)).toBe(true)
  })

  it('recognizes a cross-bundle copy, where instanceof fails', () => {
    // tokens.ts is bundled twice (Next webpack + Trigger esbuild); an error thrown in one realm
    // is not `instanceof` the other realm's class, but it still carries the name.
    const crossRealm = Object.assign(new Error(REAL.message), { name: 'ReconnectRequiredError' })
    expect(crossRealm instanceof ReconnectRequiredError).toBe(false)
    expect(isReconnectRequired(crossRealm)).toBe(true)
  })

  it('does not match on message text alone', () => {
    // A plain Error carrying the same words is NOT a reconnect fault — matching on the message
    // would let unrelated failures masquerade as one (and would break if the wording changed).
    const lookalike = new Error('Supabase connection abc requires reconnect (revoked).')
    expect(isReconnectRequired(lookalike)).toBe(false)
  })

  it('rejects everything else', () => {
    for (const v of [null, undefined, 'reconnect', 42, {}, new Error('boom')]) {
      expect(isReconnectRequired(v)).toBe(false)
    }
  })
})

describe('persistableError', () => {
  it('replaces a reconnect fault with the stable code — never the raw message', () => {
    const stored = persistableError(REAL, REAL.message)
    expect(stored).toBe(RECONNECT_REQUIRED)
    expect(stored).not.toContain('11111111')
    expect(stored).not.toMatch(/requires reconnect/)
  })

  it('leaves every other failure with its own message', () => {
    expect(persistableError(new Error('relation "orders" does not exist'), 'relation "orders" does not exist')).toBe(
      'relation "orders" does not exist',
    )
  })
})

describe('isConnectionErrorCode', () => {
  it('is true only for the stable code, so a UI can branch on a persisted column', () => {
    expect(isConnectionErrorCode(RECONNECT_REQUIRED)).toBe(true)
    expect(isConnectionErrorCode('metric query returned no numeric scalar')).toBe(false)
    expect(isConnectionErrorCode(null)).toBe(false)
    expect(isConnectionErrorCode(undefined)).toBe(false)
  })
})
