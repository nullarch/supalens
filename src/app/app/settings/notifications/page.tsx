import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { loadNotificationConfig, getNotificationTargets } from '@/lib/alerts/server'
import { slackConfigured } from '@/lib/slack-app/config'
import { PageHead } from '@/components/dashboard/PageHead'
import { NotificationsManager } from './NotificationsManager'

export const dynamic = 'force-dynamic'

/**
 * Settings › Notifications — the ONE place that says where incidents are delivered (Slack bot
 * channel / Slack webhook fallback / Discord / email recipients), with a real "send test" and a
 * preview of the exact message format. Moved here from the old alerts page so the monitors list
 * stays an operating view. Webhook URLs are posting credentials → owner/admin only; members get
 * the non-secret destination summary.
 */
export default async function NotificationsSettingsPage() {
  const t = await getTranslations('appNotifications')
  const supabase = await createClient()
  if (!supabase) return <main><PageHead title={t('title')} subtitle={t('subtitle')} /><p role="alert">{t('configUnavailable')}</p></main>
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/settings/notifications')

  const orgId = await ensurePrimaryOrg(supabase, user)
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const role = (memberRows?.[0] as { role: string } | undefined)?.role ?? 'member'
  const canConfigure = role === 'owner' || role === 'admin'

  const [config, targets] = await Promise.all([
    canConfigure ? loadNotificationConfig(orgId) : Promise.resolve(null),
    getNotificationTargets(orgId),
  ])

  return (
    <div>
      <PageHead title={t('title')} subtitle={t('subtitle')} />
      <NotificationsManager key={orgId} canConfigure={canConfigure} config={config} targets={targets} slackAppConfigured={slackConfigured()} />
    </div>
  )
}
