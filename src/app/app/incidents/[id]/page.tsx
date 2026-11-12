import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { getIncident } from '@/lib/alerts/incidents-server'
import { getOrgTimezone } from '@/lib/org/timezone'
import { IncidentDetailView } from '../IncidentDetailView'

export const dynamic = 'force-dynamic'

/**
 * /app/incidents/[id] — one incident, where `id` is the FIRED alert_events row. This is what the
 * Slack button / Discord card / email CTA deep-link to. RLS scopes both reads to the caller's orgs,
 * so a cross-tenant id resolves to nothing and 404s.
 */
export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations('appIncidents')

  const supabase = await createClient()
  if (!supabase) return <div style={{ padding: 40 }}>{t('notConfigured')}</div>
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/app/incidents/${encodeURIComponent(id)}`)

  const { incident, alert, ackReady, metricSql, description, snoozedUntil } = await getIncident(supabase, id)
  if (!incident || !alert) notFound()

  // Role + display zone follow the INCIDENT's org, never the active-org cookie: a user who is admin
  // in org A and viewer in org B, opening B's incident, must get B's (viewer) permissions. RLS
  // already limits this read to orgs the caller belongs to, so no row = no access.
  const { data: alertOrgRows } = await supabase.from('alerts').select('org_id').eq('id', alert.id).limit(1)
  const orgId = (alertOrgRows?.[0] as { org_id: string } | undefined)?.org_id
  if (!orgId) notFound()

  const [{ data: memberRows }, timezone] = await Promise.all([
    supabase.from('organization_members').select('role').eq('org_id', orgId).eq('user_id', user.id).limit(1),
    getOrgTimezone(supabase, orgId),
  ])
  // default DOWN: a missing row means the read failed, and read-only is the safe degradation.
  const role = (memberRows?.[0] as { role: string } | undefined)?.role ?? 'viewer'

  return (
    <IncidentDetailView
      incident={incident}
      alert={alert}
      description={description}
      metricSql={metricSql}
      snoozedUntil={snoozedUntil}
      ackReady={ackReady}
      canManage={role === 'owner' || role === 'admin' || role === 'member'}
      timezone={timezone}
    />
  )
}
