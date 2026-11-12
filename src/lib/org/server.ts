import 'server-only'

import { cookies } from 'next/headers'
import type { SupabaseClient, User } from '@supabase/supabase-js'

import { isSelfHosted } from '@/config/edition'

/** Cookie that pins the caller's active organization (honored by ensurePrimaryOrg + getAppChrome). */
export const ACTIVE_ORG_COOKIE = 'sl_active_org'

/** One organization the caller belongs to, with their role in it. */
export interface OrgSummary {
  id: string
  name: string
  slug: string
  role: string
}

/**
 * List every organization the caller belongs to, earliest-joined first (so
 * `[0]` is the primary org — matching `ensurePrimaryOrg` / `createDashboard`).
 * RLS on `organization_members` admits every row of the caller's orgs — co-members included —
 * so the rows are narrowed to the caller's own here. Without that an org with N members is
 * listed N times and `role` is whoever joined first, not the caller.
 */
export async function listOrgs(supabase: SupabaseClient, userId?: string): Promise<OrgSummary[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('role, user_id, created_at, organizations(id, name, slug, deleted_at)')
    .order('created_at', { ascending: true })
  if (error || !data) return []
  const uid = userId ?? (await sessionUserId(supabase))

  type Row = {
    role: string
    user_id?: string
    organizations: { id: string; name: string; slug: string; deleted_at: string | null } | null
  }
  return (data as unknown as Row[])
    .filter((m) => !uid || !m.user_id || m.user_id === uid)
    .filter((m) => m.organizations && !m.organizations.deleted_at)
    .map((m) => ({
      id: m.organizations!.id,
      name: m.organizations!.name,
      slug: m.organizations!.slug,
      role: m.role,
    }))
}

/** The signed-in user id from the session cookie. Only used to pick the caller's own rows out
 *  of rows RLS already authorised, so the unverified session read is sufficient here. */
async function sessionUserId(supabase: SupabaseClient): Promise<string | null> {
  try {
    return (await supabase.auth.getSession()).data.session?.user.id ?? null
  } catch {
    return null
  }
}

/**
 * Return the caller's primary organization id, creating a personal workspace the
 * first time (via the SECURITY DEFINER `create_organization` RPC). Runs with the
 * user's JWT so RLS applies.
 */
export async function ensurePrimaryOrg(supabase: SupabaseClient, user: User): Promise<string> {
  const { data: memberships, error } = await supabase
    .from('organization_members')
    .select('org_id, user_id, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  // RLS also returns co-members' rows of the caller's orgs; keep the caller's own.
  const ids = ((memberships ?? []) as { org_id: string; user_id?: string }[])
    .filter((m) => !m.user_id || m.user_id === user.id)
    .map((m) => m.org_id)
  if (ids.length > 0) {
    // honor the active-org cookie when it points to an org the caller belongs to
    const active = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value
    if (active && ids.includes(active)) return active
    return ids[0]
  }

  // A self-hosted install is ONE workspace whose accounts an admin creates, each with its
  // membership. An account without one (a removed member, or a stray API sign-up) must not get a
  // private workspace of its own — it has no access.
  if (isSelfHosted()) {
    const { redirect } = await import('next/navigation')
    redirect('/no-workspace')
  }

  const emailLocal = user.email?.split('@')[0]
  const name = emailLocal ? `${emailLocal}'s workspace` : 'My workspace'
  const slug = `org-${user.id.slice(0, 8)}`

  const { data: org, error: createErr } = await supabase.rpc('create_organization', {
    p_name: name,
    p_slug: slug,
  })
  if (createErr) throw createErr
  const orgId = (org as { id: string }).id
  // Link attribution: this is the workspace a brand-new signup actually gets (createOrg
  // only covers a manually created extra one), so credit the campaign from the first-touch
  // sl_ref cookie here. Best-effort + dynamic import (off the hot path; never throws). The cookie is
  // left in place — a Server Component can't mutate cookies — and the first-touch guard (one
  // campaign credit per org and per user) keeps a later createOrg from re-crediting.
  try {
    const { REF_COOKIE, recordRefConversion } = await import('@/lib/attribution/service')
    const refCode = (await cookies()).get(REF_COOKIE)?.value
    if (refCode) await recordRefConversion({ refCode, userId: user.id, orgId })
  } catch {
    /* attribution is best-effort */
  }
  // content-agent: persist the first-touch ca_variant (sl_cav cookie) for this org + enqueue the
  // `signup` event. Env-gated no-op, never throws; dynamic import keeps it off the hot path.
  try {
    const [{ CA_VARIANT_COOKIE }, { recordContentAgentOrgCreated }] = await Promise.all([
      import('@/lib/content-agent/logic'),
      import('@/lib/content-agent/events'),
    ])
    await recordContentAgentOrgCreated({ orgId, cookieValue: (await cookies()).get(CA_VARIANT_COOKIE)?.value })
  } catch {
    /* tracking is best-effort */
  }
  // brand-new user just got their first workspace → welcome email (best-effort; never throws).
  // Dynamic import keeps the email/Resend module off the hot path (ensurePrimaryOrg runs on most requests).
  if (user.email) {
    try {
      const { sendWelcomeEmail } = await import('@/lib/email/welcome')
      const { getLocale } = await import('next-intl/server')
      await sendWelcomeEmail({ to: user.email, name: user.email.split('@')[0] || '', locale: await getLocale() })
    } catch {
      /* welcome email is best-effort */
    }
  }
  return orgId
}

/** One member of an org, joined with their profile (via the list_org_members RPC). */
export interface MemberRow {
  userId: string
  email: string | null
  displayName: string | null
  role: string
  joinedAt: string
}

/**
 * Full member roster for an org. Uses the SECURITY DEFINER `list_org_members`
 * RPC (any member may read it) because the `profiles` RLS policy only exposes
 * the caller's own row — a plain join would hide co-members.
 */
export async function listOrgMembers(supabase: SupabaseClient, orgId: string): Promise<MemberRow[]> {
  const { data, error } = await supabase.rpc('list_org_members', { p_org: orgId })
  // A failed read is not an empty team; let the localized app error boundary offer retry.
  if (error || !Array.isArray(data)) throw new Error('team_members_unavailable')
  type Row = { user_id: string; email: string | null; display_name: string | null; role: string; created_at: string }
  return (data as unknown as Row[]).map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    joinedAt: r.created_at,
  }))
}

/** A pending invitation shown on the members screen (owner/admin only, via RLS). */
export interface InvitationRow {
  id: string
  email: string
  role: string
  createdAt: string
  expiresAt: string
}

/**
 * Pending invitations for an org. The `oi_sel` RLS policy restricts this to
 * owner/admin callers; members simply get an empty list.
 */
export async function listPendingInvitations(
  supabase: SupabaseClient,
  orgId: string,
): Promise<InvitationRow[]> {
  const { data, error } = await supabase
    .from('organization_invitations')
    .select('id, email, role, created_at, expires_at')
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  // RLS-hidden invitations correctly return []; failed/unknown reads must remain distinct.
  if (error || !Array.isArray(data)) throw new Error('team_invitations_unavailable')
  type Row = { id: string; email: string; role: string; created_at: string; expires_at: string }
  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }))
}
