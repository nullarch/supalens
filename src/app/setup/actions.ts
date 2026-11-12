'use server'

import { isSelfHosted } from '@/config/edition'
import { createInternalUser, deleteInternalUser, instanceHasUsers } from '@/lib/instance/accounts'
import { createAdminClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'

export type SetupResult =
  | { ok: true }
  | { ok: false; code: 'unavailable' | 'already_setup' | 'invalid_email' | 'weak_password' | 'email_exists' | 'failed' }

/**
 * One-time setup of a self-hosted install: the first visitor becomes the owner of the single
 * workspace. After this, accounts exist only when an admin creates them.
 *
 * Order matters. The account is created with the service role (public sign-up is closed), the
 * instance is switched to single-workspace BEFORE the workspace is created, and the workspace is
 * created through the same `create_organization` RPC as everywhere else. That RPC takes a row lock
 * on the instance settings, so of two people racing through this screen exactly one succeeds and
 * the other's half-created account is removed.
 */
export async function completeSetup(input: { email: string; password: string; workspace: string }): Promise<SetupResult> {
  if (!isSelfHosted()) return { ok: false, code: 'unavailable' }
  const admin = createAdminClient()
  const supabase = await createClient()
  if (!admin || !supabase) return { ok: false, code: 'unavailable' }
  if (await instanceHasUsers(admin)) return { ok: false, code: 'already_setup' }

  const created = await createInternalUser(input.email, input.password, admin)
  if ('error' in created) return { ok: false, code: created.error === 'unconfigured' ? 'unavailable' : created.error }

  const undo = async (code: 'already_setup' | 'failed'): Promise<SetupResult> => {
    await supabase.auth.signOut().catch(() => {})
    await deleteInternalUser(created.userId, admin)
    return { ok: false, code }
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: input.email.trim().toLowerCase(),
    password: input.password,
  })
  if (signInError) return undo('failed')

  const { error: flagError } = await admin.from('instance_settings').update({ single_workspace: true }).eq('id', true)
  if (flagError) return undo('failed')

  const name = input.workspace.trim().slice(0, 80) || 'Workspace'
  const { error: orgError } = await supabase.rpc('create_organization', { p_name: name, p_slug: 'workspace' })
  if (orgError) return undo(orgError.message.includes('single_workspace') ? 'already_setup' : 'failed')

  await admin
    .from('instance_settings')
    .update({ setup_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', true)
  return { ok: true }
}
