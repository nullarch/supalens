'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import type { ActionResult } from '@/lib/dashboards/types'
import { disconnectSupabase } from '@/lib/supabase-oauth/disconnect'
import { disconnectGithub } from '@/lib/github-app/disconnect'
import { disconnectSlack } from '@/lib/slack-app/disconnect'
import { removeDirectDataSource } from '@/lib/data-sources/remove'
import { revokeAllApiKeysForOrg } from '@/lib/mcp/keys'
import { forgetHubPerson } from '@/lib/event-hub/events'
import { ACTIVE_ORG_COOKIE } from '@/lib/org/server'
import type { Actor } from '@/lib/secrets/service'

/**
 * Destructive account/organization deletion. Both are owner-gated and route every
 * connected credential through the SAME revocation paths the integrations UI uses
 * (disconnectSupabase / disconnectGithub / disconnectSlack / removeDirectDataSource),
 * plus every `sl_` API key, so nothing is orphaned: secrets are revoked, minted roles
 * dropped (or outboxed), pools closed, alerts disabled, widgets detached. The org row
 * itself is SOFT-deleted (matching the schema's live-slug index); membership + pending
 * invites are removed so the org disappears from every member's list immediately.
 */

interface AuthedUser {
  userId: string
  email: string | null
}

async function authedUser(): Promise<{ error?: ActionResult; user?: AuthedUser }> {
  const supabase = await createClient()
  if (!supabase) return { error: { ok: false, reason: 'unconfigured' } }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: { ok: false, reason: 'unauthorized' } }
  return { user: { userId: user.id, email: user.email ?? null } }
}

/**
 * Shared teardown: revoke/disconnect every credentialed resource, then soft-delete the org.
 * Throws on any failure in the steps that must succeed for the org to be considered fully
 * torn down (callers rely on this to decide whether it's safe to proceed — e.g. `deleteAccount`
 * only deletes the auth user once every owned org's teardown has actually succeeded).
 */
async function teardownOrg(orgId: string, actor: Actor): Promise<void> {
  const admin = requireAdminClient()

  const { data: conns } = await admin
    .from('provider_connections')
    .select('id, provider')
    .eq('org_id', orgId)
    .is('deleted_at', null)
  for (const c of (conns ?? []) as { id: string; provider: string }[]) {
    try {
      if (c.provider === 'github') await disconnectGithub(c.id)
      else if (c.provider === 'slack') await disconnectSlack(c.id)
      else await disconnectSupabase(c.id, actor)
    } catch (err) {
      console.warn(`[delete-org] disconnect ${c.provider} ${c.id} failed:`, err)
    }
  }

  const { data: directSources } = await admin
    .from('data_sources')
    .select('id')
    .eq('org_id', orgId)
    .is('connection_id', null)
    .is('deleted_at', null)
  for (const s of (directSources ?? []) as { id: string }[]) {
    try {
      await removeDirectDataSource(s.id, actor)
    } catch (err) {
      console.warn(`[delete-org] remove data source ${s.id} failed:`, err)
    }
  }

  // revoke every `sl_` API key so a key minted before deletion can't keep hitting MCP
  // tools afterward (verifyApiKey never checks organizations.deleted_at)
  await revokeAllApiKeysForOrg(orgId)

  // disable remaining alerts org-wide (belt-and-braces; per-source cleanup got most)
  const { error: alertsErr } = await admin
    .from('alerts')
    .update({ enabled: false })
    .eq('org_id', orgId)
    .is('deleted_at', null)
  if (alertsErr) throw new Error(`disable alerts failed: ${alertsErr.message}`)

  const now = new Date().toISOString()
  const { error: orgErr } = await admin.from('organizations').update({ deleted_at: now }).eq('id', orgId)
  if (orgErr) throw new Error(`soft-delete org failed: ${orgErr.message}`)

  const { error: invErr } = await admin.from('organization_invitations').delete().eq('org_id', orgId)
  if (invErr) throw new Error(`delete invitations failed: ${invErr.message}`)

  const { error: memErr } = await admin.from('organization_members').delete().eq('org_id', orgId)
  if (memErr) throw new Error(`delete members failed: ${memErr.message}`)
}

/** True when the org still has a live paid subscription the owner must cancel first. */
async function hasActivePaidSubscription(orgId: string): Promise<boolean> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('organizations')
    .select('plan, subscription_status')
    .eq('id', orgId)
    .limit(1)
  const org = (data?.[0] ?? null) as { plan: string | null; subscription_status: string | null } | null
  if (!org) return false
  const status = org.subscription_status ?? ''
  return (org.plan ?? 'free') !== 'free' && ['active', 'trialing', 'past_due'].includes(status)
}

/**
 * Delete an organization. Owner only. Blocked while a paid subscription is live —
 * deleting the org would strand the Paddle subscription (self-serve cancel is in
 * the billing portal), so the owner cancels there first.
 */
export async function deleteOrg(orgId: string): Promise<ActionResult> {
  const a = await authedUser()
  if (a.error) return a.error
  const { userId } = a.user!
  const t = await getTranslations('appSettings')

  const admin = requireAdminClient()
  const { data: memberRow } = await admin
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .limit(1)
  if (((memberRow?.[0] as { role: string } | undefined)?.role ?? '') !== 'owner') {
    return { ok: false, reason: 'error', message: t('danger.deleteOrg.notOwner') }
  }

  if (await hasActivePaidSubscription(orgId)) {
    return { ok: false, reason: 'error', message: t('danger.deleteOrg.activeSubscription') }
  }

  try {
    await teardownOrg(orgId, { kind: 'user', id: userId })
  } catch (err) {
    console.error(`[delete-org] teardown ${orgId} failed:`, err)
    return { ok: false, reason: 'error', message: t('danger.deleteOrg.failed') }
  }

  const jar = await cookies()
  if (jar.get(ACTIVE_ORG_COOKIE)?.value === orgId) jar.delete(ACTIVE_ORG_COOKIE)
  revalidatePath('/app', 'layout')
  return { ok: true, data: undefined }
}

/**
 * Delete the caller's account (회원탈퇴 — the flow the privacy policy promises).
 * Solo-owned orgs are torn down with the account; an org with OTHER members blocks
 * deletion until ownership is transferred (same last-owner rule as leave_org).
 * Finally the auth user is deleted (profiles cascades via FK) — the client must
 * sign out and redirect after an ok result.
 *
 * `auth.admin.deleteUser` only runs once EVERY owned org's teardown has actually
 * succeeded (§partial-failure below) — never after a partial run, so a failure here
 * never masks already-torn-down orgs behind a generic "account deletion failed"
 * message the user could mistake for "nothing happened."
 */
export async function deleteAccount(): Promise<ActionResult> {
  const a = await authedUser()
  if (a.error) return a.error
  const { userId } = a.user!
  const admin = requireAdminClient()
  const t = await getTranslations('appSettings')

  const { data: memberships } = await admin
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', userId)
  const rows = (memberships ?? []) as { org_id: string; role: string }[]

  for (const m of rows) {
    if (m.role !== 'owner') continue
    const { count } = await admin
      .from('organization_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', m.org_id)
      .neq('user_id', userId)
    if ((count ?? 0) > 0) {
      return { ok: false, reason: 'error', message: t('danger.deleteAccount.hasOtherMembers') }
    }
    if (await hasActivePaidSubscription(m.org_id)) {
      return { ok: false, reason: 'error', message: t('danger.deleteAccount.activeSubscription') }
    }
  }

  // solo-owned orgs die with the account; other memberships are simply removed. A failed
  // teardown is collected (not thrown) so a sibling org's teardown still gets attempted —
  // but the loop below never proceeds to deleteUser while any org failed, and a retry is
  // idempotent (a fully-torn-down org's membership row is already gone, so the next call's
  // `memberships` query only re-attempts the ones that failed).
  const failedOrgIds: string[] = []
  for (const m of rows) {
    if (m.role === 'owner') {
      try {
        await teardownOrg(m.org_id, { kind: 'user', id: userId })
      } catch (err) {
        console.error(`[delete-account] teardown org ${m.org_id} failed:`, err)
        failedOrgIds.push(m.org_id)
      }
    } else {
      await admin.from('organization_members').delete().eq('org_id', m.org_id).eq('user_id', userId)
    }
  }
  if (failedOrgIds.length > 0) {
    return { ok: false, reason: 'error', message: t('danger.deleteAccount.teardownFailed') }
  }

  // every owned org is confirmed torn down at this point. One retry absorbs a transient
  // failure; if it still fails, the org data is already gone — say so plainly rather than
  // returning the generic "failed" message, which would read as "nothing happened."
  let deleteErr = (await admin.auth.admin.deleteUser(userId)).error
  if (deleteErr) deleteErr = (await admin.auth.admin.deleteUser(userId)).error
  if (deleteErr) {
    console.error(`[delete-account] deleteUser ${userId} failed after full teardown:`, deleteErr)
    return { ok: false, reason: 'error', message: t('danger.deleteAccount.finalStepFailed') }
  }

  await forgetHubPerson(userId)

  ;(await cookies()).delete(ACTIVE_ORG_COOKIE)
  return { ok: true, data: undefined }
}
