import { describe, expect, it } from 'vitest'

import { OAuthError } from './client'
import { isInvalidGrantError } from './tokens'

// Response shapes measured against the live api.supabase.com/v1/oauth/token endpoint
// (2026-07-11): a dead/rotated refresh token is 404 {"message":"No such refresh token
// found"}, NOT the RFC 6749 401/invalid_grant this module originally matched.
describe('isInvalidGrantError', () => {
  it('matches RFC 6749 401', () => {
    expect(isInvalidGrantError(new OAuthError('unauthorized', 401))).toBe(true)
  })

  it('matches an explicit invalid_grant code regardless of status', () => {
    expect(isInvalidGrantError(new OAuthError('bad grant', 400, 'invalid_grant'))).toBe(true)
  })

  it('matches Supabase\'s real dead-token shape: 404 "No such refresh token found"', () => {
    expect(isInvalidGrantError(new OAuthError('No such refresh token found', 404))).toBe(true)
  })

  it('does NOT match a routing-style 404 that never mentions the token', () => {
    expect(isInvalidGrantError(new OAuthError('not found', 404))).toBe(false)
  })

  it('does NOT match 422 "Unrecognized client_id" (host misconfig must not revoke the connection)', () => {
    expect(isInvalidGrantError(new OAuthError('Unrecognized client_id', 422))).toBe(false)
  })
})
