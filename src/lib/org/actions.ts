'use server'

import { revalidatePath } from 'next/cache'
import { isSelfHosted } from '@/config/edition'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import type { ActionResult } from '@/lib/dashboards/types'
import { sendInviteEmail } from '@/lib/email/invite'
import { enforceSeatLimit, enforceInviteRateLimit } from '@/lib/plans/usage'
import { cookies } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'
import { ACTIVE_ORG_COOKIE } from '@/lib/org/server'
import { isMissingColumnError, isValidTimezone } from '@/lib/org/timezone'
import { REF_COOKIE, recordRefConversion } from '@/lib/attribution/service'
import { CA_VARIANT_COOKIE } from '@/lib/content-agent/logic'
import { recordContentAgentOrgCreated } from '@/lib/content-agent/events'

const ORG_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 365 }

/**
 * Mutations for organizations (workspaces). User-JWT server client, so RLS +
 * the SECURITY DEFINER `create_organization` RPC enforce ownership. When
 * Supabase is unconfigured they return { ok:false, reason:'unconfigured' }.
 */

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // Korean / non-ascii names slugify to empty → always add a short unique suffix
  return `${base || 'org'}-${Date.now().toString(36).slice(-4)}`
}

/**
 * Create a new organization and add the caller as its owner, atomically, via
 * the `create_organization` RPC. A direct client INSERT on `organizations` is
 * blocked by RLS (only an org_write UPDATE policy exists), so the RPC is the
 * only path — it also creates the owner membership row in one transaction.
 */
export async function createOrg(name: string): Promise<ActionResult<{ id: string; slug: string }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }

  const t = await getTranslations('orgActions')
  // A self-hosted install is one workspace (also enforced in create_organization once set up).
  if (isSelfHosted()) return { ok: false, reason: 'error', message: t('errors.single_workspace') }
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'error', message: t('emptyName') }

  // Per-user org cap (billing-INDEPENDENT abuse guard, like MAX_RUNS_PER_ORG_PER_DAY): the daily LLM
  // run cap is PER-ORG, so unlimited orgs-per-user multiplies a user's free budget N×. Cap how many
  // orgs one user can OWN. A normal user owns 1 org (well under the cap) so is never affected. Set
  // MAX_ORGS_PER_USER=0 to disable. (UI-path guard; the SECURITY DEFINER RPC could still be called
  // directly — a DB-level backstop in create_organization is a follow-up if hard enforcement is needed.)
  const orgCap = Number(process.env.MAX_ORGS_PER_USER ?? (isSelfHosted() ? 0 : 3))
  if (Number.isFinite(orgCap) && orgCap > 0) {
    const { count } = await supabase
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('role', 'owner')
    if ((count ?? 0) >= orgCap) {
      return { ok: false, reason: 'error', message: t('orgCapReached', { cap: orgCap }) }
    }
  }

  const { data, error } = await supabase.rpc('create_organization', {
    p_name: trimmed,
    p_slug: slugify(trimmed),
  })
  if (error) return { ok: false, reason: 'error', message: error.message }

  const org = data as { id: string; slug: string } | null
  // switch the caller into the new org immediately (else active stays the old orgs[0] → dead-end)
  if (org?.id) {
    const jar = await cookies()
    jar.set(ACTIVE_ORG_COOKIE, org.id, ORG_COOKIE_OPTS)
    // Link attribution: if this user arrived via a tracked /r/<code> link, credit the
    // content campaign (a no-op when their first workspace — ensurePrimaryOrg — already
    // did). Best-effort — never throws, never blocks org creation. Clear the cookie so a later
    // workspace isn't double-attributed.
    const refCode = jar.get(REF_COOKIE)?.value
    if (refCode) {
      await recordRefConversion({ refCode, userId: user.id, orgId: org.id })
      jar.delete(REF_COOKIE)
    }
    // content-agent: attribute this org to the first-touch ca_variant (sl_cav) + enqueue `signup`.
    // Env-gated no-op, never throws. The cookie is kept: attribution is per org, so a workspace
    // created later in the 30-day window is attributed to the same variant.
    await recordContentAgentOrgCreated({ orgId: org.id, cookieValue: jar.get(CA_VARIANT_COOKIE)?.value })
  }
  revalidatePath('/app')
  return { ok: true, data: { id: org?.id ?? '', slug: org?.slug ?? '' } }
}

/** Switch the caller's active organization. RLS confirms membership; the cookie is honored by
 *  ensurePrimaryOrg + getAppChrome so the switch propagates to every /app page. */
export async function setActiveOrg(orgId: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }
  const { data } = await supabase.from('organization_members').select('org_id').eq('org_id', orgId).limit(1)
  if (!data || data.length === 0) {
    const t = await getTranslations('orgActions')
    return { ok: false, reason: 'error', message: t('notAMember') }
  }
  ;(await cookies()).set(ACTIVE_ORG_COOKIE, orgId, ORG_COOKIE_OPTS)
  revalidatePath('/app', 'layout')
  return { ok: true, data: undefined }
}

/**
 * Rename an organization. Authorization is enforced by the `org_write` RLS
 * UPDATE policy (owner/admin only) — a non-privileged caller's UPDATE simply
 * matches zero rows. The slug is intentionally immutable (it is the URL id).
 */
export async function renameOrg(orgId: string, name: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }

  const t = await getTranslations('orgActions')
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'error', message: t('emptyName') }

  const { data, error } = await supabase
    .from('organizations')
    .update({ name: trimmed })
    .eq('id', orgId)
    .select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) {
    // RLS matched no row → caller isn't owner/admin of this org.
    return { ok: false, reason: 'error', message: t('renamePermissionDenied') }
  }

  revalidatePath('/app/settings')
  revalidatePath('/app')
  return { ok: true, data: undefined }
}

/**
 * Toggle the workspace-level weekly-digest opt-in (default off). Owner/admin only —
 * authorization is the `org_write` RLS UPDATE policy (a non-privileged caller's UPDATE
 * matches zero rows), exactly like renameOrg. `weekly_digest_enabled` is deliberately NOT a
 * guard-trigger billing column, so this normal user-JWT update is allowed.
 */
export async function setWeeklyDigestEnabled(orgId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }

  const t = await getTranslations('orgActions')
  const { data, error } = await supabase
    .from('organizations')
    .update({ weekly_digest_enabled: enabled })
    .eq('id', orgId)
    .select('id')
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data || data.length === 0) {
    // RLS matched no row → caller isn't owner/admin of this org.
    return { ok: false, reason: 'error', message: t('renamePermissionDenied') }
  }
  revalidatePath('/app/settings')
  return { ok: true, data: undefined }
}

/**
 * Set the workspace display timezone. Owner/admin only — authorization is the `org_write`
 * RLS UPDATE policy (a non-privileged caller's UPDATE matches zero rows), exactly like
 * renameOrg. `timezone` is deliberately NOT a guard-trigger billing column, so this normal
 * user-JWT update is allowed.
 *
 * Fails OPEN before the migration lands: a 42703 (column does not exist) is reported as
 * `reason:'pending_migration'` so the form can show a "not live yet" note instead of a raw
 * Postgres error — the repo's deploy-before-migration convention.
 */
export async function updateOrgTimezone(orgId: string, timezone: string): Promise<ActionResult> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }

  const t = await getTranslations('appSettings')
  // Validate against the runtime's own zone table — the DB CHECK is only a shape guard.
  if (!isValidTimezone(timezone)) {
    return { ok: false, reason: 'error', message: t('timezone.invalid') }
  }

  const { data, error } = await supabase
    .from('organizations')
    .update({ timezone })
    .eq('id', orgId)
    .select('id')
  if (error) {
    if (isMissingColumnError(error)) {
      return { ok: false, reason: 'error', message: t('timezone.pendingMigration') }
    }
    return { ok: false, reason: 'error', message: error.message }
  }
  if (!data || data.length === 0) {
    // RLS matched no row → caller isn't owner/admin of this org.
    const org = await getTranslations('orgActions')
    return { ok: false, reason: 'error', message: org('renamePermissionDenied') }
  }
  revalidatePath('/app/settings')
  return { ok: true, data: undefined }
}

// ─────────────────────────────────────────────────────────────────────────
// Member management. Every mutation calls a SECURITY DEFINER RPC that enforces
// caller role + role hierarchy + last-owner safety (see migration
// 20260701000000_member_management.sql). The actions add auth + friendly error
// mapping + revalidation; they do NOT re-implement the authorization rules.
// ─────────────────────────────────────────────────────────────────────────

/** Roles a caller can assign via invite / role-change (never 'owner'). */
export type AssignableRole = 'admin' | 'member' | 'viewer'

// Codes raised by the SECURITY DEFINER member-management RPCs (migration
// 20260701000000_member_management.sql). Each carries a localized message under
// orgActions.errors.<code>.
const KNOWN_RPC_ERROR_CODES = [
  'forbidden',
  'target_outranks_caller',
  'role_above_caller',
  'cannot_change_own_role',
  'use_transfer_ownership',
  'use_leave_org',
  'last_owner_must_transfer',
  'already_member',
  'invalid_email',
  'cannot_invite_owner',
  'not_a_member',
  'invite_not_found',
  'invite_not_pending',
  'invite_expired',
  'email_mismatch',
  // two concurrent invites to the same email race past the pending-revoke and
  // hit the partial unique index — surface it as "already invited", not a raw
  // Postgres duplicate-key message.
  'org_invite_pending_email',
  'email_not_confirmed',
  'already_owner',
] as const

type OrgActionsT = Awaited<ReturnType<typeof getTranslations>>

/** Map a raised DB exception message onto a translated, user-facing string. */
function friendlyError(t: OrgActionsT, raw?: string): string {
  if (!raw) return t('genericFailed')
  for (const code of KNOWN_RPC_ERROR_CODES) {
    if (raw.includes(code)) return t(`errors.${code}`)
  }
  return raw
}

/** Shared preamble: resolve the JWT client + authenticated user + the translator. */
async function authed() {
  const supabase = await createClient()
  if (!supabase) return { error: { ok: false as const, reason: 'unconfigured' as const } }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: { ok: false as const, reason: 'unauthorized' as const } }
  const t = await getTranslations('orgActions')
  return { supabase, user, t }
}

const MEMBERS_PATH = '/app/settings/members'

/**
 * Invite an email to the org with a given role. Owner/admin only (RPC-enforced).
 * The invitation row is persisted first via `invite_member`; sending the email
 * is a best-effort follow-up that can never roll that back — if Resend isn't
 * configured or delivery fails, `emailSent:false` tells the UI to offer a
 * "copy the invite link" fallback instead of silently lying that mail went out.
 */
export async function inviteMember(
  orgId: string,
  email: string,
  role: AssignableRole,
): Promise<ActionResult<{ token: string; emailSent: boolean; link: string }>> {
  const a = await authed()
  if (a.error) return a.error

  const locale = await getLocale()
  const seat = await enforceSeatLimit(orgId, locale)
  if (!seat.ok) return { ok: false, reason: 'error', message: seat.error }

  // billing-independent anti-spam cap — the seat limit is a no-op without Paddle
  const rate = await enforceInviteRateLimit(orgId, email, locale)
  if (!rate.ok) return { ok: false, reason: 'error', message: rate.error }

  const { data, error } = await a.supabase.rpc('invite_member', {
    p_org: orgId,
    p_email: email,
    p_role: role,
  })
  if (error) return { ok: false, reason: 'error', message: friendlyError(a.t, error.message) }
  const inv = data as { token: string } | null
  const token = inv?.token ?? ''

  const [{ data: orgRows }, { data: profRows }] = await Promise.all([
    a.supabase.from('organizations').select('name').eq('id', orgId).limit(1),
    a.supabase.from('profiles').select('display_name, email').eq('id', a.user.id).limit(1),
  ])
  const orgName = (orgRows?.[0] as { name: string } | undefined)?.name ?? 'Supalens'
  const prof = (profRows?.[0] as { display_name: string | null; email: string | null } | undefined) ?? null
  const inviterName = prof?.display_name || prof?.email?.split('@')[0] || a.t('defaultInviterName')

  const emailResult = await sendInviteEmail({ to: email, orgName, inviterName, role, token, locale: await getLocale() })

  revalidatePath(MEMBERS_PATH)
  return { ok: true, data: { token, emailSent: emailResult.sent, link: emailResult.link } }
}

/** Change an existing member's role. Owner/admin only; hierarchy-guarded. */
export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: AssignableRole,
): Promise<ActionResult> {
  const a = await authed()
  if (a.error) return a.error
  const { error } = await a.supabase.rpc('update_member_role', {
    p_org: orgId,
    p_user: userId,
    p_role: role,
  })
  if (error) return { ok: false, reason: 'error', message: friendlyError(a.t, error.message) }
  revalidatePath(MEMBERS_PATH)
  return { ok: true, data: undefined }
}

/** Remove another member from the org. Owner/admin only; hierarchy-guarded. */
export async function removeMember(orgId: string, userId: string): Promise<ActionResult> {
  const a = await authed()
  if (a.error) return a.error
  const { error } = await a.supabase.rpc('remove_member', { p_org: orgId, p_user: userId })
  if (error) return { ok: false, reason: 'error', message: friendlyError(a.t, error.message) }
  // retire the removed member's MCP credentials (sl_ keys + OAuth tokens). verifyMcpToken
  // already rejects them live via the membership re-check; this cleans up the rows.
  try {
    const { revokeApiKeysForUser } = await import('@/lib/mcp/keys')
    await revokeApiKeysForUser(orgId, userId)
  } catch (e) {
    console.error('[org] key revocation after member removal failed:', e)
  }
  // Self-hosted accounts exist only as members of the one workspace, so removing the member
  // removes the login too (otherwise it would linger as an account with no access).
  if (isSelfHosted()) {
    try {
      const { deleteInternalUser } = await import('@/lib/instance/accounts')
      if (!(await deleteInternalUser(userId))) console.error('[org] account deletion after member removal failed')
    } catch (e) {
      console.error('[org] account deletion after member removal failed:', e)
    }
  }
  revalidatePath(MEMBERS_PATH)
  return { ok: true, data: undefined }
}

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1, viewer: 0 }

/** The caller's role in the org, or null. Own row only (RLS also returns co-members' rows). */
async function callerRole(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>, orgId: string, userId: string): Promise<string | null> {
  const { data } = await supabase.from('organization_members').select('role').eq('org_id', orgId).eq('user_id', userId).limit(1)
  return (data?.[0] as { role?: string } | undefined)?.role ?? null
}

/**
 * Self-hosted only: create a member's account directly (email + initial password) and add it to
 * the workspace. No email is involved — the admin hands the credentials over. Same hierarchy rule
 * as `invite_member`: owner/admin only, and only a role strictly below the caller's own.
 */
export async function createMemberAccount(
  orgId: string,
  email: string,
  password: string,
  role: AssignableRole,
): Promise<ActionResult> {
  const a = await authed()
  if (a.error) return a.error
  if (!isSelfHosted()) return { ok: false, reason: 'error', message: a.t('genericFailed') }
  const mine = await callerRole(a.supabase, orgId, a.user.id)
  if (mine !== 'owner' && mine !== 'admin') return { ok: false, reason: 'error', message: a.t('errors.forbidden') }
  if (!(role in ROLE_RANK) || ROLE_RANK[role] >= ROLE_RANK[mine]) {
    return { ok: false, reason: 'error', message: a.t('errors.role_above_caller') }
  }

  const admin = createAdminClient()
  if (!admin) return { ok: false, reason: 'unconfigured' }
  const { createInternalUser, deleteInternalUser } = await import('@/lib/instance/accounts')
  const created = await createInternalUser(email, password, admin)
  if ('error' in created) {
    return created.error === 'unconfigured'
      ? { ok: false, reason: 'unconfigured' }
      : { ok: false, reason: 'error', message: a.t(`account.${created.error}`, { min: 8 }) }
  }
  // organization_members has no client write policy; the profile row it references was created
  // synchronously by the auth trigger.
  const { error } = await admin.from('organization_members').insert({ org_id: orgId, user_id: created.userId, role })
  if (error) {
    await deleteInternalUser(created.userId, admin)
    return { ok: false, reason: 'error', message: a.t('genericFailed') }
  }
  revalidatePath(MEMBERS_PATH)
  return { ok: true, data: undefined }
}

/**
 * Self-hosted only: set a new password for a member who lost theirs. Owner/admin only, and only
 * for a member strictly below the caller (the same rule as removing one).
 */
export async function resetMemberPassword(orgId: string, userId: string, password: string): Promise<ActionResult> {
  const a = await authed()
  if (a.error) return a.error
  if (!isSelfHosted()) return { ok: false, reason: 'error', message: a.t('genericFailed') }
  const mine = await callerRole(a.supabase, orgId, a.user.id)
  if (mine !== 'owner' && mine !== 'admin') return { ok: false, reason: 'error', message: a.t('errors.forbidden') }
  const target = await callerRole(a.supabase, orgId, userId)
  if (!target) return { ok: false, reason: 'error', message: a.t('errors.not_a_member') }
  if (userId === a.user.id || ROLE_RANK[target] >= ROLE_RANK[mine]) {
    return { ok: false, reason: 'error', message: a.t('errors.target_outranks_caller') }
  }
  const { setInternalUserPassword } = await import('@/lib/instance/accounts')
  const result = await setInternalUserPassword(userId, password)
  if ('error' in result) {
    return result.error === 'unconfigured'
      ? { ok: false, reason: 'unconfigured' }
      : { ok: false, reason: 'error', message: a.t(`account.${result.error}`, { min: 8 }) }
  }
  return { ok: true, data: undefined }
}

/** Leave the org yourself. Blocked for the last owner (must transfer first). */
export async function leaveOrg(orgId: string): Promise<ActionResult> {
  const a = await authed()
  if (a.error) return a.error
  const { error } = await a.supabase.rpc('leave_org', { p_org: orgId })
  if (error) return { ok: false, reason: 'error', message: friendlyError(a.t, error.message) }
  // same as removeMember: the leaver's org-scoped MCP credentials die with the membership
  try {
    const { revokeApiKeysForUser } = await import('@/lib/mcp/keys')
    await revokeApiKeysForUser(orgId, a.user.id)
  } catch (e) {
    console.error('[org] key revocation after leave failed:', e)
  }
  revalidatePath(MEMBERS_PATH)
  return { ok: true, data: undefined }
}

/** Hand ownership to an existing member; the caller (owner) becomes admin. */
export async function transferOwnership(orgId: string, userId: string): Promise<ActionResult> {
  const a = await authed()
  if (a.error) return a.error
  const { error } = await a.supabase.rpc('transfer_ownership', { p_org: orgId, p_user: userId })
  if (error) return { ok: false, reason: 'error', message: friendlyError(a.t, error.message) }
  revalidatePath(MEMBERS_PATH)
  return { ok: true, data: undefined }
}

/** Revoke a pending invitation. Owner/admin only. */
export async function revokeInvitation(inviteId: string): Promise<ActionResult> {
  const a = await authed()
  if (a.error) return a.error
  const { error } = await a.supabase.rpc('revoke_invitation', { p_invite: inviteId })
  if (error) return { ok: false, reason: 'error', message: friendlyError(a.t, error.message) }
  revalidatePath(MEMBERS_PATH)
  return { ok: true, data: undefined }
}

/** Accept an invitation by token (invitee's email must match). */
export async function acceptInvitation(token: string): Promise<ActionResult<{ orgId: string }>> {
  const a = await authed()
  if (a.error) return a.error
  const { data, error } = await a.supabase.rpc('accept_invitation', { p_token: token })
  if (error) return { ok: false, reason: 'error', message: friendlyError(a.t, error.message) }
  const orgId = (data as string | null) ?? ''
  // switch the accepter into the org they just joined — otherwise ensurePrimaryOrg
  // keeps their previous active org and the accept looks like it silently failed.
  if (orgId) {
    ;(await cookies()).set(ACTIVE_ORG_COOKIE, orgId, ORG_COOKIE_OPTS)
  }
  revalidatePath('/app', 'layout')
  return { ok: true, data: { orgId } }
}

/**
 * Update the caller's OWN email opt-out flags for one org (the settings-page
 * counterpart of the one-click unsubscribe link). organization_members has no
 * client write policy (member management is RPC-only), so this goes through
 * the admin client — safe because the update is keyed on the caller's own
 * user_id: a non-member simply matches zero rows.
 */
export async function updateEmailPrefs(
  orgId: string,
  prefs: { digestOptOut?: boolean; alertOptOut?: boolean; lifecycleOptOut?: boolean },
): Promise<ActionResult> {
  const a = await authed()
  if (a.error) return a.error
  const admin = createAdminClient()
  if (!admin) return { ok: false, reason: 'unconfigured' }

  const patch: Record<string, boolean> = {}
  if (typeof prefs.digestOptOut === 'boolean') patch.email_digest_opt_out = prefs.digestOptOut
  if (typeof prefs.alertOptOut === 'boolean') patch.email_alert_opt_out = prefs.alertOptOut
  if (typeof prefs.lifecycleOptOut === 'boolean') patch.email_lifecycle_opt_out = prefs.lifecycleOptOut
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined }

  const { error } = await admin
    .from('organization_members')
    .update(patch)
    .eq('org_id', orgId)
    .eq('user_id', a.user.id)
  if (error) return { ok: false, reason: 'error', message: friendlyError(a.t, error.message) }
  revalidatePath('/app/settings')
  return { ok: true, data: undefined }
}
