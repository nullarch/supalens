'use client'

import { useTranslations } from 'next-intl'

import { useBillingPortal, type BillingPortalIO } from './use-billing-portal'
import s from '@/app/app/settings/billing/billing.module.css'

/**
 * Billing-banner actions. Paid orgs get a "Manage subscription" button → Paddle customer
 * portal (self-serve cancel / change / update payment). Free orgs (and paid orgs with no
 * linked billing profile) get a link down to the plan-comparison cards (#plans) — the
 * cards own checkout, so the banner never offers a second parallel purchase path.
 */
export function PlanActions({ plan, hasBilling, actions }: { plan: string; hasBilling: boolean; actions?: BillingPortalIO }) {
  const { busy, error, manage } = useBillingPortal(actions)
  const t = useTranslations('appBilling')

  if (plan !== 'free' && hasBilling) {
    return (
      <div className={s.bannerActionStack}>
        <button className={s.bannerPrimary} type="button" onClick={manage} disabled={busy}>
          {busy ? t('opening') : t('manageSubscription')}
        </button>
        {error ? <span className={s.bannerError} role="alert">{error}</span> : null}
      </div>
    )
  }

  return (
    <a className={s.bannerPrimary} href="#plans">
      {t('viewPlans')}
    </a>
  )
}
