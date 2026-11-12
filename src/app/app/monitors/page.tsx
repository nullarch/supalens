import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { listAlerts, listActiveDataSources, getNotificationTargets, getMonitorDraft } from '@/lib/alerts/server'
import { listIncidents } from '@/lib/alerts/incidents-server'
import { effectiveCheckInterval } from '@/lib/alerts/evaluate'
import { getPlanLimit } from '@/lib/plans/limits'
import { getOrgTimezone } from '@/lib/org/timezone'
import { IncidentsTable, parseFilter } from '../incidents/IncidentsTable'
import { MonitorsManager } from './MonitorsManager'
import { ViewSwitch } from './ViewSwitch'
import { monitorsViewHref, parseMonitorsView } from './view'

export const dynamic = 'force-dynamic'

/**
 * /app/monitors — the single 감시 screen, with two URL-driven views: the monitors list (no param)
 * and the incidents queue (`?view=incidents`, which kept its own `?status=` filter). A monitor and
 * an incident are the same object in two states, so /app/incidents now redirects here; only the
 * incident DETAIL keeps its own route (/app/incidents/[id]), because email / Slack / Discord deep
 * links point at it.
 *
 * Channel configuration lives in /app/settings/notifications; this page only reads the NON-SECRET
 * destination summary so every member can see where an incident would land.
 */
export default async function MonitorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string; edit?: string; new?: string; filter?: string; status?: string
    /** goal composer prefill (`?new=goal&goal=…&source=…`) and a persisted draft (`?draft=<runId>`) */
    goal?: string; source?: string; draft?: string
  }>
}) {
  const t = await getTranslations('appMonitors')
  const supabase = await createClient()
  if (!supabase) {
    return <div style={{ padding: 40 }}>{t('notConfigured')}</div>
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const sp = await searchParams
  const view = parseMonitorsView(sp.view)
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(monitorsViewHref(view, sp.status))}`)
  }

  const orgId = await ensurePrimaryOrg(supabase, user)

  // Both lists are read on every load because the switch carries both counts.
  const [alerts, { incidents }, timezone] = await Promise.all([
    forView(view === 'monitors', () => listAlerts(supabase, orgId), []),
    forView(view === 'incidents', () => listIncidents(supabase, orgId), { incidents: [], ackReady: true }),
    getOrgTimezone(supabase, orgId),
  ])
  const counts = {
    monitors: alerts.length,
    // what the queue shows by default (`parseFilter` → 'openish'): everything not resolved yet
    incidents: incidents.filter((i) => i.status !== 'resolved').length,
  }
  const viewSwitch = <ViewSwitch view={view} counts={counts} />

  if (view === 'incidents') {
    return (
      <div data-page-width="wide">
        {viewSwitch}
        <IncidentsTable incidents={incidents} filter={parseFilter(sp.status)} timezone={timezone} />
      </div>
    )
  }

  const [dataSources, { data: memberRows }, { data: orgRows }, targets] = await Promise.all([
    listActiveDataSources(supabase, orgId),
    supabase.from('organization_members').select('role').eq('org_id', orgId).eq('user_id', user.id).limit(1),
    supabase.from('organizations').select('plan').eq('id', orgId).limit(1),
    getNotificationTargets(orgId),
  ])
  const role = (memberRows?.[0] as { role: string } | undefined)?.role ?? 'member'
  const canManage = role === 'owner' || role === 'admin' || role === 'member'
  const canConfigure = role === 'owner' || role === 'admin'

  // Cadence is per plan (enforced by the runner) and floored to the cron period — resolve it ONCE
  // here so the list, the form note and the detail page all say the same interval.
  const plan = (orgRows?.[0] as { plan?: string | null } | undefined)?.plan ?? null
  const checkIntervalSec = effectiveCheckInterval(getPlanLimit(plan, 'alert_min_check_interval'))

  // Goal → monitor: `?draft=<runId>` reopens a persisted draft on its approval card (RLS-scoped);
  // `?new=goal` opens the composer, optionally prefilled.
  const initialDraft = sp.draft ? await getMonitorDraft(supabase, sp.draft) : null
  const initialGoal =
    sp.new === 'goal' || sp.goal ? { goal: (sp.goal ?? '').slice(0, 500), sourceId: sp.source ?? null } : null

  return (
    <div data-page-width="wide">
      {viewSwitch}
      <MonitorsManager
        alerts={alerts}
        dataSources={dataSources}
        canManage={canManage}
        canConfigure={canConfigure}
        targets={targets}
        checkIntervalSec={checkIntervalSec}
        timezone={timezone}
        initialEditId={sp.edit ?? null}
        initialNew={sp.new === 'sql'}
        initialFilter={sp.filter ?? null}
        initialGoal={initialGoal}
        initialDraft={initialDraft}
      />
    </div>
  )
}

/**
 * Read one view's list. Both reads deliberately THROW on failure (`listAlerts` via assertReadable,
 * `listIncidents` in incidents-server.ts) because an empty monitors list or incident queue reads as
 * an all-clear on a monitoring product. That contract is kept for the view being RENDERED; for the
 * other view the read only feeds a count badge, so a fault there drops the badge rather than taking
 * down the page the operator actually asked for.
 */
async function forView<T>(rendered: boolean, read: () => Promise<T>, fallback: T): Promise<T> {
  if (rendered) return read()
  try {
    return await read()
  } catch (e) {
    console.error('[monitors] view-switch count read failed:', e)
    return fallback
  }
}
