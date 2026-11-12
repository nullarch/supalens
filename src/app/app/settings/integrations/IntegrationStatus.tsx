'use client'

import { useTranslations } from 'next-intl'
import { integrationStatus } from './presentation'
import s from './integrations.module.css'

export function IntegrationStatus({ status }: { status: string }) {
  const t = useTranslations('appIntegrations')
  const value = integrationStatus(status)
  return <span className={s.statusLabel} data-integration-status={value.label} data-intent={value.intent}>{t(`status.${value.label}`)}</span>
}
