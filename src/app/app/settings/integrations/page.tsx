import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { slackConfigured } from '@/lib/slack-app/config'
import { botTokenForConnection } from '@/lib/slack-app/token'
import { listConversations } from '@/lib/slack-app/client'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { userHasOrgRole } from '@/lib/org/require-role'
import { loadIntegrationRows } from './settings-data'
import { IntegrationsView } from './IntegrationsView'
import s from './integrations.module.css'

export const dynamic = 'force-dynamic'
// The resync server action provisions Supabase projects inline (list → per-project pooler
// fetch/config refresh, plus a role mint per NEW project) — give it headroom beyond the
// 15s serverless default. Applies to this segment's action POSTs as well as the page GET.
export const maxDuration = 60

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; connecting?: string; projects?: string; skipped?: string; repos?: string; team?: string; error?: string }>
}) {
  const sp = await searchParams
  const t = await getTranslations('appIntegrations')
  const supabase = await createClient()
  if (!supabase) {
    return <main className={s.page}>{t('page.notConfigured')}</main>
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login?next=/app/settings/integrations')
  }

  const orgId = await ensurePrimaryOrg(supabase, user)
  const canManage = await userHasOrgRole(supabase, orgId, user.id)
  const canAnalyze = await userHasOrgRole(supabase, orgId, user.id, ['owner', 'admin', 'member'])
  const { conns, sources, repos } = await loadIntegrationRows(supabase, orgId)

  const slackConns = conns.filter((c) => c.provider === 'slack')
  const slackReady = slackConfigured()

  // Each picker belongs to its own connection; failed reads never imply unrestricted access.
  const slackScopes = new Map<string, { channels: Array<{ id: string; name: string }>; selected: string[]; unavailable: boolean }>()
  for (const connection of canManage ? slackConns : []) {
    slackScopes.set(connection.id, { channels: [], selected: [], unavailable: true })
    if (connection.status !== 'active') continue
    try {
      const admin = requireAdminClient()
      const { data: meta, error: metaError } = await admin
        .from('provider_connections')
        .select('metadata')
        .eq('id', connection.id).eq('org_id', orgId).eq('provider', 'slack').eq('status', 'active').is('deleted_at', null)
        .limit(1)
      if (metaError || !meta?.length) throw new Error('slack_scope_unavailable')
      const raw = (meta[0] as { metadata?: { allowed_channel_ids?: unknown } }).metadata
        ?.allowed_channel_ids
      if (raw != null && (!Array.isArray(raw) || raw.some(value => typeof value !== 'string'))) throw new Error('slack_scope_unavailable')
      const selected = Array.isArray(raw) ? raw as string[] : []
      const token = await botTokenForConnection(connection.id)
      if (token) slackScopes.set(connection.id, { channels: await listConversations(token), selected, unavailable: false })
    } catch (e) {
      console.error('[integrations] slack channel scope load failed:', e)
    }
  }
  return <IntegrationsView orgId={orgId} conns={conns} sources={sources} repos={repos}
    slackReady={slackReady} slackScopes={Object.fromEntries(slackScopes)} canManage={canManage} canAnalyze={canAnalyze} params={sp} />
}
