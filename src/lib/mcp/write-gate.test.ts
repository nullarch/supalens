import { describe, expect, it } from 'vitest'

import { assertMcpWriteAllowed, type McpAuthContext } from './auth'

// Pin the MCP write boundary (SEC-1): viewer tokens and read-only tokens must never reach the
// write tools, while creator-less org keys (mint path already requires member+) stay allowed.
const ctx = (over: Partial<McpAuthContext>): McpAuthContext => ({
  orgId: 'org',
  apiKeyId: 'key',
  createdBy: 'user',
  role: 'member',
  scopes: ['read', 'write'],
  ...over,
})

describe('assertMcpWriteAllowed', () => {
  it('allows owner/admin/member with write scope', () => {
    for (const role of ['owner', 'admin', 'member']) {
      expect(() => assertMcpWriteAllowed(ctx({ role }))).not.toThrow()
    }
  })

  it('rejects a viewer even when the token carries the write scope', () => {
    expect(() => assertMcpWriteAllowed(ctx({ role: 'viewer' }))).toThrow(/viewer/)
  })

  it('rejects a token without the write scope regardless of role', () => {
    expect(() => assertMcpWriteAllowed(ctx({ scopes: ['read'] }))).toThrow(/write/)
  })

  it('allows a creator-less org key (role null) with write scope', () => {
    expect(() => assertMcpWriteAllowed(ctx({ createdBy: null, role: null }))).not.toThrow()
  })
})
