'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { integrationReturnNotice, type IntegrationReturnParams } from './presentation'
import s from './integrations.module.css'
import { isRecoveryId } from '@/lib/alerts/recovery'

export function IntegrationReturnNotice({ params }: { params: IntegrationReturnParams }) {
  const t = useTranslations('appIntegrations')
  const notice = integrationReturnNotice(params)
  if (!params.error && isRecoveryId(params.supabaseConnection) && (params.connected === 'supabase' || params.connecting === 'supabase')) return null
  if (!notice) return null
  if (notice.kind === 'error') return <div className={s.banner} data-kind="error" role="alert">{t(`returnNotice.${notice.reason}`)}</div>
  return <div className={s.banner} data-kind="info" role="status">
    {t('returnNotice.returned', { provider: notice.provider })}
    {notice.importing && <p>{t('returnNotice.importing')}</p>}
    {notice.planLimited && <p>{t('returnNotice.plan')} <Link className={s.link} href="/app/settings/billing">{t('page.bannerSkippedForPlanCta')}</Link></p>}
  </div>
}
