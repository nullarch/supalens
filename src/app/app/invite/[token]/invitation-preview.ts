import type { SupabaseClient } from '@supabase/supabase-js'

export type InvitePreview = {
  email: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  status: 'pending' | 'accepted' | 'revoked'
  expires_at: string
  organizations: { name: string; deleted_at: string | null } | null
}

/** Called only after the page authenticates the invitee. Keep the privileged
 * read bound to the exact invitation token; never turn read failure into empty.
 */
export async function readInvitationPreview(admin: Pick<SupabaseClient, 'from'>, token: string): Promise<InvitePreview | null> {
  const { data, error } = await admin
    .from('organization_invitations')
    .select('email, role, status, expires_at, organizations(name, deleted_at)')
    .eq('token', token)
    .limit(1)
  if (error || !Array.isArray(data)) throw new Error('Invitation preview unavailable')
  if (data.length === 0) return null
  if (data.length !== 1) throw new Error('Invitation preview unavailable')
  const row = data[0] as Record<string, unknown> | null
  if (!row || typeof row.email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(row.email)
    || typeof row.role !== 'string' || !['owner', 'admin', 'member', 'viewer'].includes(row.role)
    || typeof row.status !== 'string' || !['pending', 'accepted', 'revoked'].includes(row.status)
    || typeof row.expires_at !== 'string' || !Number.isFinite(Date.parse(row.expires_at))) {
    throw new Error('Invitation preview unavailable')
  }
  if (row.organizations !== null) {
    const org = row.organizations as Record<string, unknown> | undefined
    if (!org || typeof org !== 'object' || Array.isArray(org) || typeof org.name !== 'string' || !org.name.trim()
      || !(org.deleted_at === null || (typeof org.deleted_at === 'string' && Number.isFinite(Date.parse(org.deleted_at))))) throw new Error('Invitation preview unavailable')
  }
  return row as InvitePreview
}
