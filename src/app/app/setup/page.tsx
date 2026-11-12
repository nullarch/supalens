import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { userHasOrgRole } from '@/lib/org/require-role'
import { getActivationState } from '@/lib/activation/state'
import { effectiveCheckInterval } from '@/lib/alerts/evaluate'
import { getPlanLimit } from '@/lib/plans/limits'
import { listConnectionProjects, type SupabaseProjectChoice } from '@/lib/data-sources/supabase-projects'
import { getBootstrapStatus, type BootstrapStatus } from '@/lib/bootstrap/status'
import { loadNotificationConfig } from '@/lib/alerts/server'
import { slackConfigured } from '@/lib/slack-app/config'
import { SetupClient } from './SetupClient'

export const dynamic = 'force-dynamic'

/**
 * /app/setup — the Golden Path shell. Deliberately NOT a wizard with a cursor: every render
 * recomputes the ORG activation state, so an OAuth round-trip, a closed tab or a colleague
 * finishing a step all resume correctly. Nothing here writes a "completed" flag.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getTranslations('appSetup')
  const sp = await searchParams
  const supabase = await createClient()
  if (!supabase) {
    return <div style={{ padding: 40 }}>{t('notConfigured')}</div>
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login?next=/app/setup')
  }

  const orgId = await ensurePrimaryOrg(supabase, user)
  const [activation, { data: sourceRows }, { data: repoRows }, { data: orgRows }] = await Promise.all([
    getActivationState(supabase, orgId),
    supabase
      .from('data_sources')
      .select('id, name, repo_id, is_demo, created_at')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    supabase.from('github_repositories').select('id, full_name').eq('org_id', orgId).is('deleted_at', null),
    supabase.from('organizations').select('plan').eq('id', orgId).limit(1),
  ])

  const real = ((sourceRows ?? []) as { id: string; name: string; repo_id: string | null; is_demo: boolean }[]).filter((r) => !r.is_demo)
  const first = real[0] ?? null
  const repoName = first?.repo_id
    ? (((repoRows ?? []) as { id: string; full_name: string }[]).find((r) => r.id === first.repo_id)?.full_name ?? null)
    : null

  // Scan progress for the "understanding"/"KPI" steps. Derived from persisted state, so an
  // in-flight scan started on another device (or before a reload) is picked up on first paint.
  let scanStatus: BootstrapStatus | null = null
  if (first) {
    try {
      scanStatus = await getBootstrapStatus(first.id)
    } catch (e) {
      // Never let a progress read break the Golden Path — the step's own CTA still works.
      console.error('[setup] scan status read failed:', e)
    }
  }

  // The Slack destination NAME is not a secret, but notification_channels is owner/admin-only
  // under RLS — read it through the service-role client, scoped to this org (same pattern as
  // /app/sources). Best-effort: without it the completion card just says "email".
  let slackChannel: string | null = null
  const admin = createAdminClient()
  if (admin) {
    try {
      const { data } = await admin
        .from('notification_channels')
        .select('label, target')
        .eq('org_id', orgId)
        .eq('provider', 'slack')
        .eq('enabled', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
      const row = data?.[0] as { label: string | null; target: string } | undefined
      slackChannel = row ? row.label || row.target : null
    } catch {
      /* best-effort */
    }
  }

  const plan = (orgRows?.[0] as { plan?: string | null } | undefined)?.plan ?? null
  const canConfigure = await userHasOrgRole(supabase, orgId, user.id)

  // Project picker. Connecting no longer provisions every project, so the choice happens here.
  // Loading it costs a Management-API call, so only ask when it can actually be needed: right
  // after the OAuth round-trip (`?select=supabase`), or on resume — connected, nothing chosen yet.
  const justConnected = sp.select === 'supabase'
  let projects: SupabaseProjectChoice[] = []
  let showPicker = false
  let needsReconnect = false
  if (justConnected || !activation.steps.db_connected) {
    try {
      const listed = await listConnectionProjects(orgId)
      if (listed) {
        projects = listed.projects
        needsReconnect = listed.needsReconnect
        // A dead grant still owns the step: the user cannot pick a project until they
        // re-authorize, so the picker renders its reconnect state rather than an empty list.
        showPicker = needsReconnect || projects.some((p) => p.bootstrappable && p.state !== 'active')
      }
    } catch (e) {
      // A Management-API fault must not break the Golden Path — the step's own CTA still works.
      console.error('[setup] project listing failed:', e)
    }
  }

  // Slack step data. `loadNotificationConfig` also reads posting credentials, so it is only
  // called for owner/admin; members get the connect-less view and the settings link.
  const notif = canConfigure && slackConfigured() ? await loadNotificationConfig(orgId) : null

  return (
    <SetupClient
      orgId={orgId}
      projects={projects}
      showPicker={showPicker}
      needsReconnect={needsReconnect}
      canConfigure={canConfigure}
      slackAppConfigured={slackConfigured()}
      slackConnected={notif?.slackConnected ?? false}
      slackChannels={notif?.slackChannels ?? []}
      selectedSlackChannel={notif?.selectedSlackChannel ?? null}
      steps={activation.steps}
      nextStep={activation.nextStep}
      suggestions={activation.suggestions}
      completed={activation.completed}
      firstSourceId={first?.id ?? null}
      firstSourceName={first?.name ?? null}
      repoName={repoName}
      slackChannel={slackChannel}
      kpisAccepted={activation.counts.kpisAccepted}
      monitorsEnabled={activation.counts.monitorsEnabled}
      scanStatus={scanStatus}
      hasRepo={Boolean(first?.repo_id)}
      intervalSec={effectiveCheckInterval(getPlanLimit(plan, 'alert_min_check_interval'))}
    />
  )
}
