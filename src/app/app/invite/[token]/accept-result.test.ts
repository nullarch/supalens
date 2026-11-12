import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { acceptanceResult } from './accept-result'

describe('invitation acceptance acknowledgement', () => {
  it('requires a successful response with a nonempty organization ID', () => {
    expect(acceptanceResult({ ok: true, data: { orgId: 'sample-org' } })).toEqual({ kind: 'accepted', orgId: 'sample-org' })
  })
  it.each([undefined, null, 0, 'success', [], {}, { ok: 'true' }, { ok: true }, { ok: true, data: null }, { ok: true, data: {} }, { ok: true, data: { orgId: '' } }, { ok: true, data: { orgId: '  ' } }, { ok: true, data: { orgId: 42 } }, { ok: false }, { ok: false, reason: 'surprise' }])('does not turn malformed response %j into known success/rejection', value => {
    expect(acceptanceResult(value)).toEqual({ kind: 'unconfirmed' })
  })
  it.each(['error', 'unconfigured', 'unauthorized', 'not_found'])('recognizes %s without exposing raw messages', reason => {
    expect(acceptanceResult({ ok: false, reason, message: 'PRIVATE_RPC_SENTINEL' })).toEqual({ kind: 'rejected', reason })
  })
  it('keeps authentication ahead of token-scoped preview and explicit acceptance', () => {
    const path = 'src/app/app/invite/[token]/page.tsx'
    const current = readFileSync(path, 'utf8')
    for (const guard of ['await supabase.auth.getUser()', 'if (!user)', 'createAdminClient()', 'readInvitationPreview(admin, token)', '<AcceptForm']) expect(current).toContain(guard)
    expect(current.indexOf('if (!user)')).toBeLessThan(current.indexOf('createAdminClient()'))
    expect(current.indexOf('readInvitationPreview(admin, token)')).toBeLessThan(current.indexOf('<AcceptForm'))
    expect(current).toContain("inv.email.toLowerCase() !== (user.email ?? '').toLowerCase()")
    expect(current).toContain("if (new Date(inv.expires_at) < new Date())")
    expect(current).not.toContain('acceptInvitation(')
  })
  it.each(['en', 'ko', 'ja'])('has complete localized state copy for %s', locale => {
    const copy = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')).appMembers.accept
    for (const key of ['confirmHelp', 'accepted', 'viewMembers', 'opening', 'navigationFailed', 'unconfirmed', 'rejected', 'sessionUnavailable', 'serviceUnavailable', 'reload', 'reloading', 'reloadFailed', 'previewTitle', 'previewUnavailable']) {
      expect(typeof copy[key]).toBe('string')
      expect(copy[key].length).toBeGreaterThan(0)
    }
  })
})
