import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { getAlert, listAlertEventsFor, getNotificationTargets } from '@/lib/alerts/server'
import { effectiveCheckInterval } from '@/lib/alerts/evaluate'
import { getPlanLimit } from '@/lib/plans/limits'
import { getOrgTimezone } from '@/lib/org/timezone'

import { MonitorDetailView } from './MonitorDetailView'

export const dynamic = 'force-dynamic'


/**
 * /app/monitors/[id] — one monitor: what it measures (the verified definition + the SQL behind it
 * under a disclosure), its current value against the range it is expected to stay inside, the
 * monitoring settings, where incidents go, and the incident history with the AI's likely cause kept
 * visibly separate from the data facts. Email / Slack / Discord deep-link here.
 */
export default async function MonitorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations('appMonitors')

  const supabase = await createClient()
  if (!supabase) return <div style={{ padding: 40 }}>{t('notConfigured')}</div>
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/app/monitors/${encodeURIComponent(id)}`)

  // ensurePrimaryOrg only picks the ACTIVE org; the permissions, plan cadence and destinations on
  // this page must follow the MONITOR's org instead. A user who is admin in A and viewer in B would
  // otherwise open B's monitor and see A's role and A's notification destinations.
  await ensurePrimaryOrg(supabase, user)
  const alert = await getAlert(supabase, id) // RLS: own-org rows only → cross-tenant ids 404
  if (!alert) notFound()
  const orgId = alert.orgId

  const [events, { data: memberRows }, { data: orgRows }, targets, timezone] = await Promise.all([
    listAlertEventsFor(supabase, alert.id),
    supabase.from('organization_members').select('role').eq('org_id', orgId).eq('user_id', user.id).limit(1),
    supabase.from('organizations').select('plan').eq('id', orgId).limit(1),
    getNotificationTargets(orgId),
    getOrgTimezone(supabase, orgId),
  ])
  // default DOWN, not up: RLS already proved membership, so a missing row means the read failed —
  // degrade to the read-only view rather than to manage rights.
  const role = (memberRows?.[0] as { role: string } | undefined)?.role ?? 'viewer'
  const canManage = role === 'owner' || role === 'admin' || role === 'member'
  const canConfigure = role === 'owner' || role === 'admin'
  const plan = (orgRows?.[0] as { plan?: string | null } | undefined)?.plan ?? null
  const intervalSec = effectiveCheckInterval(getPlanLimit(plan, 'alert_min_check_interval'))
  return <MonitorDetailView alert={alert} events={events} targets={targets} timezone={timezone} intervalSec={intervalSec} canManage={canManage} canConfigure={canConfigure} />
}
