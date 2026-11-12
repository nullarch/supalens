// Internal accounts for a self-hosted install: created with the service role, never by public
// sign-up. Web-server only (setup screen + member actions), so `server-only` is safe here.
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createAdminClient } from '@/utils/supabase/admin'

export const MIN_PASSWORD_LENGTH = 8

export type AccountError = 'unconfigured' | 'invalid_email' | 'weak_password' | 'email_exists' | 'failed'

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

export function passwordProblem(password: string): 'weak_password' | null {
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= 200 ? null : 'weak_password'
}

function accountErrorFrom(error: { code?: string; status?: number; message?: string }): AccountError {
  if (error.code === 'email_exists' || error.code === 'user_already_exists' || error.status === 422) return 'email_exists'
  if (error.code === 'weak_password') return 'weak_password'
  if (error.code === 'validation_failed' || error.code === 'email_address_invalid') return 'invalid_email'
  return 'failed'
}

let knownToHaveUsers = false

/**
 * Whether any account exists yet. `false` means the install is fresh and the one-time setup
 * screen should be shown. A positive answer never reverts in practice, so it is cached for the
 * life of the process; a negative one is re-read every time.
 * Fails CLOSED (reports users) when the service role is unavailable, so a misconfigured install
 * never exposes the setup screen.
 */
export async function instanceHasUsers(admin: SupabaseClient | null = createAdminClient()): Promise<boolean> {
  if (knownToHaveUsers) return true
  if (!admin) return true
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) return true
  if (data.users.length > 0) knownToHaveUsers = true
  return knownToHaveUsers
}

/** Create a confirmed email + password account. The auth trigger creates its profile row. */
export async function createInternalUser(
  email: string,
  password: string,
  admin: SupabaseClient | null = createAdminClient(),
): Promise<{ userId: string } | { error: AccountError }> {
  if (!admin) return { error: 'unconfigured' }
  const normalized = normalizeEmail(email)
  if (!normalized) return { error: 'invalid_email' }
  if (passwordProblem(password)) return { error: 'weak_password' }
  const { data, error } = await admin.auth.admin.createUser({ email: normalized, password, email_confirm: true })
  if (error || !data.user) return { error: accountErrorFrom(error ?? {}) }
  knownToHaveUsers = true
  return { userId: data.user.id }
}

/** Set a new password for an existing account. */
export async function setInternalUserPassword(
  userId: string,
  password: string,
  admin: SupabaseClient | null = createAdminClient(),
): Promise<{ ok: true } | { error: AccountError }> {
  if (!admin) return { error: 'unconfigured' }
  if (passwordProblem(password)) return { error: 'weak_password' }
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  return error ? { error: accountErrorFrom(error) } : { ok: true }
}

/** Delete an account outright (roll back a half-created one, or remove a member's login). */
export async function deleteInternalUser(userId: string, admin: SupabaseClient | null = createAdminClient()): Promise<boolean> {
  if (!admin) return false
  const { error } = await admin.auth.admin.deleteUser(userId)
  return !error
}
