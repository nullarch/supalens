import type { SupabaseClient } from '@supabase/supabase-js'

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

/**
 * Does `userId` hold one of `roles` in `orgId`? Uses the user-JWT client, so RLS already limits
 * rows to the caller's orgs — this is the extra role gate for owner/admin-only server actions.
 * Non-throwing so callers can map to their own error convention (thrown Error vs ActionResult).
 */
export async function userHasOrgRole(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  roles: OrgRole[] = ['owner', 'admin'],
): Promise<boolean> {
  const { data } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .limit(1)
  const role = (data?.[0] as { role?: string } | undefined)?.role
  return !!role && (roles as string[]).includes(role)
}

/** Resolve a live provider_connection to its org_id (RLS-visible only), or null. */
export async function orgOfConnection(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('provider_connections')
    .select('org_id')
    .eq('id', connectionId)
    .is('deleted_at', null)
    .limit(1)
  return (data?.[0] as { org_id?: string } | undefined)?.org_id ?? null
}
