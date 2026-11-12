'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { disconnectSupabase } from '@/lib/supabase-oauth/disconnect'
import { resyncSupabaseProjects } from '@/lib/supabase-oauth/connect'
import { disconnectGithub } from '@/lib/github-app/disconnect'
import { disconnectSlack } from '@/lib/slack-app/disconnect'
import { userHasOrgRole, orgOfConnection } from '@/lib/org/require-role'
import { isReconnectRequired } from '@/lib/supabase-oauth/tokens'

const INTEGRATIONS_PATH = '/app/settings/integrations'

/**
 * Shared gate for the connection-scoped actions (disconnect/resync): authenticate, resolve the
 * connection's org (RLS-visible + not soft-deleted), and require the caller be owner/admin of it.
 * Throws on any failure. Returns the actor + org the helpers need.
 */
async function authorizeConnectionAction(
  formData: FormData
): Promise<{ connectionId: string; userId: string; orgId: string }> {
  const connectionId = String(formData.get('connectionId') ?? '')
  if (!connectionId) throw new Error('missing connectionId')

  const supabase = await createClient()
  if (!supabase) throw new Error('supabase_not_configured')
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('unauthorized')

  const orgId = await orgOfConnection(supabase, connectionId)
  if (!orgId || !(await userHasOrgRole(supabase, orgId, user.id))) throw new Error('forbidden')
  return { connectionId, userId: user.id, orgId }
}

/** Disconnect a Supabase connection. Requires the caller be owner/admin of its org. */
export async function disconnectSupabaseAction(formData: FormData): Promise<void> {
  const { connectionId, userId } = await authorizeConnectionAction(formData)
  await disconnectSupabase(connectionId, { kind: 'user', id: userId })
  revalidatePath(INTEGRATIONS_PATH)
}

/** Disconnect a GitHub connection. Requires the caller be owner/admin of its org. */
export async function disconnectGithubAction(formData: FormData): Promise<void> {
  const { connectionId } = await authorizeConnectionAction(formData)
  await disconnectGithub(connectionId)
  revalidatePath(INTEGRATIONS_PATH)
}

/** Disconnect a Slack workspace. Requires the caller be owner/admin of its org. */
export async function disconnectSlackAction(formData: FormData): Promise<void> {
  const { connectionId } = await authorizeConnectionAction(formData)
  await disconnectSlack(connectionId)
  revalidatePath(INTEGRATIONS_PATH)
}

/**
 * Re-run project provisioning for a Supabase connection: imports projects created since
 * connect and refreshes each source's stored pooler config (the heal path for sources
 * bootstrapped host-less). Runs no LLM (no quota gate needed); the bootstrap itself is
 * idempotent — active sources are never re-minted, so stored credentials keep working.
 */
export async function resyncSupabaseProjectsAction(formData: FormData): Promise<void> {
  const { connectionId, userId, orgId } = await authorizeConnectionAction(formData)

  const admin = requireAdminClient()
  const { data } = await admin
    .from('provider_connections')
    .select('provider, status')
    .eq('id', connectionId)
    .is('deleted_at', null)
    .limit(1)
  const conn = data?.[0] as { provider: string; status: string } | undefined
  if (!conn || conn.provider !== 'supabase' || conn.status !== 'active') {
    throw new Error('not an active supabase connection')
  }

  try {
    await resyncSupabaseProjects({ orgId, userId, connectionId })
  } catch (e) {
    // A dead grant is an expected lifecycle end, not a crash: the connection row is already
    // marked revoked by the token layer, so re-rendering the page shows the reconnect CTA.
    // Letting it throw would hit the /app error boundary and hide the way out.
    if (!isReconnectRequired(e)) throw e
    console.warn(`[integrations] resync skipped — connection ${connectionId} needs reconnect`)
  }
  revalidatePath(INTEGRATIONS_PATH)
}

/**
 * Set the mention allowlist for the org's Slack workspace (owner/admin). Empty list clears it →
 * the bot answers in ANY channel (default trust model); a non-empty list scopes mentions to those
 * channels. Stored in the connection's non-secret metadata (channel ids aren't secrets).
 */
export async function setSlackAllowedChannelsAction(channelIds: string[], connectionId?: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, message: 'supabase_not_configured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'unauthorized' }
  const orgId = await ensurePrimaryOrg(supabase, user)
  const t = await getTranslations('appIntegrations')
  if (!(await userHasOrgRole(supabase, orgId, user.id)))
    return { ok: false, message: t('page.slackScope.noPermission') }

  const clean = Array.from(new Set(channelIds.filter((c) => typeof c === 'string').map(c => c.trim()).filter(Boolean)))

  const admin = requireAdminClient()
  let lookup = admin
    .from('provider_connections')
    .select('id, metadata')
    .eq('org_id', orgId)
    .eq('provider', 'slack')
    .eq('status', 'active')
    .is('deleted_at', null)
  if (connectionId) lookup = lookup.eq('id', connectionId)
  const { data: conn, error: readError } = await lookup.limit(1)
  if (readError || !Array.isArray(conn)) return { ok: false, message: t('page.slackScope.saveFailed') }
  const row = conn?.[0] as { id: string; metadata: Record<string, unknown> | null } | undefined
  if (!row) return { ok: false, message: t('page.slackScope.notConnected') }

  const metadata = { ...(row.metadata ?? {}), allowed_channel_ids: clean }
  const { data: updated, error } = await admin.from('provider_connections').update({ metadata })
    .eq('id', row.id).eq('org_id', orgId).eq('provider', 'slack').eq('status', 'active').is('deleted_at', null).select('id')
  if (error || !updated?.length) return { ok: false, message: t('page.slackScope.saveFailed') }
  revalidatePath(INTEGRATIONS_PATH)
  return { ok: true }
}

/**
 * Toggle a repository's auto-analysis on/off. RLS policy `ghrepo_write`
 * (owner/admin/member) enforces membership + role on the UPDATE, so no extra
 * role check is needed here — the user JWT client cannot touch other orgs' rows.
 */
export async function toggleRepoAnalysisAction(formData: FormData): Promise<{ ok: boolean }> {
  const repoId = String(formData.get('repoId') ?? '').trim()
  const rawEnabled = formData.get('enabled')
  if (!repoId || (rawEnabled !== 'true' && rawEnabled !== 'false')) return { ok: false }
  const enabled = rawEnabled === 'true'

  const supabase = await createClient()
  if (!supabase) throw new Error('supabase_not_configured')

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('unauthorized')

  const { data, error } = await supabase
    .from('github_repositories')
    .update({ analysis_enabled: enabled })
    .eq('id', repoId)
    .is('deleted_at', null)
    .select('id, analysis_enabled')
  if (error || !Array.isArray(data) || data.length !== 1 || data[0].id !== repoId || data[0].analysis_enabled !== enabled) return { ok: false }

  revalidatePath('/app/settings/integrations')
  return { ok: true }
}
