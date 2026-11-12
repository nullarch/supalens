import 'server-only'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

/**
 * Platform-staff flag (profiles.is_admin) for the CURRENT request's user.
 *
 * This is a GLOBAL per-user attribute (supalens staff), NOT the per-(user,org)
 * organization_members.role. It gates staff-only affordances in the product — e.g.
 * the dashboard "how is this metric computed" SQL debug panel.
 *
 * The read goes through the untyped service-role admin client (filtered to the
 * caller's own id) so it compiles before `db:types` regenerates schema.type.ts with
 * the new column — the same reason getAppChrome reads the billing columns via admin.
 * Fails closed: anon / unconfigured / non-admin / any error → false.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient()
  if (!supabase) return false

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false

  const admin = createAdminClient()
  if (!admin) return false

  const { data } = await admin.from('profiles').select('is_admin').eq('id', user.id).limit(1)
  const row = data?.[0] as { is_admin?: boolean } | undefined
  return row?.is_admin === true
}
