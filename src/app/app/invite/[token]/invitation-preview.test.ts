import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readInvitationPreview } from './invitation-preview'

const invitation = { email: 'invitee@example.invalid', role: 'member', status: 'pending', expires_at: '2027-01-01T00:00:00Z', organizations: { name: 'Northstar', deleted_at: null } }
function client(response: unknown, reject = false) {
  const limit = reject ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response)
  const eq = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { admin: { from } as unknown as Pick<SupabaseClient, 'from'>, from, select, eq, limit }
}
describe('invitation preview read contract', () => {
  it('reads only the exact token and existing preview columns', async () => {
    const mock = client({ data: [invitation], error: null })
    expect(await readInvitationPreview(mock.admin, 'sample-token')).toEqual(invitation)
    expect(mock.from).toHaveBeenCalledExactlyOnceWith('organization_invitations')
    expect(mock.select).toHaveBeenCalledExactlyOnceWith('email, role, status, expires_at, organizations(name, deleted_at)')
    expect(mock.eq).toHaveBeenCalledExactlyOnceWith('token', 'sample-token')
    expect(mock.limit).toHaveBeenCalledExactlyOnceWith(1)
  })
  it('distinguishes successful empty reads from failed reads', async () => {
    expect(await readInvitationPreview(client({ data: [], error: null }).admin, 'sample')).toBeNull()
    await expect(readInvitationPreview(client({ data: [], error: { message: 'PRIVATE_QUERY_SENTINEL' } }).admin, 'sample')).rejects.toThrow('Invitation preview unavailable')
  })
  it('does not turn a thrown transport into empty invitation data', async () => {
    await expect(readInvitationPreview(client(new Error('local transport'), true).admin, 'sample')).rejects.toThrow()
  })
  it.each([null, {}, [null], [invitation, invitation], [{ ...invitation, email: null }], [{ ...invitation, email: 'malformed' }], [{ ...invitation, role: 'unexpected' }], [{ ...invitation, role: ['member'] }], [{ ...invitation, status: 'unexpected' }], [{ ...invitation, expires_at: 'invalid' }], [{ ...invitation, organizations: [] }], [{ ...invitation, organizations: {} }], [{ ...invitation, organizations: { name: '', deleted_at: null } }], [{ ...invitation, organizations: { name: 'Sample', deleted_at: 'invalid' } }]])('rejects malformed preview data %j', async data => {
    await expect(readInvitationPreview(client({ data, error: null }).admin, 'sample')).rejects.toThrow('Invitation preview unavailable')
  })
  it.each(['pending', 'accepted', 'revoked'])('preserves %s for the page precheck', async status => {
    const row = { ...invitation, status }
    expect(await readInvitationPreview(client({ data: [row], error: null }).admin, 'sample')).toEqual(row)
  })
  it.each([null, { name: 'Northstar', deleted_at: '2026-01-01T00:00:00Z' }])('preserves absent/deleted workspace for the invalid-invitation screen', async organizations => {
    const row = { ...invitation, organizations }
    expect(await readInvitationPreview(client({ data: [row], error: null }).admin, 'sample')).toEqual(row)
  })
})
