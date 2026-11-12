'use client'

import { useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { CheckoutButton, type CheckoutIO } from './CheckoutButton'
import { useBillingPortal, type BillingPortalIO } from './use-billing-portal'
import type { BillingInterval } from '@/lib/paddle/config'
import { PLAN_LIMITS, PLAN_ORDER, PLAN_PRICE_USD, formatLimit, type PlanTier } from '@/lib/plans/limits'
import { effectiveCheckInterval } from '@/lib/alerts/evaluate'
import s from './PlanCards.module.css'

/**
 * Plan-comparison cards: what each tier actually includes (from PLAN_LIMITS, the enforcement
 * SSOT — so the pitch can never drift from the caps) + the checkout CTA. A monthly/yearly
 * toggle appears only when yearly price ids are configured. While a paid subscription is
 * live, tier changes go through the Paddle portal (a second checkout would double-subscribe),
 * so the CTAs switch to portal links. When Paddle isn't configured, CTAs are disabled with a
 * notice instead of failing on click.
 */
export function PlanCards({
  currentPlan,
  billingConfigured,
  yearlyAvailable,
  adminTestAvailable = false,
  actions,
}: {
  currentPlan: PlanTier
  billingConfigured: boolean
  yearlyAvailable: boolean
  /** platform-staff (profiles.is_admin) $1 test checkout — server-verified again in startCheckout */
  adminTestAvailable?: boolean
  actions?: { checkout: CheckoutIO; portal: BillingPortalIO }
}) {
  const [interval, setInterval] = useState<BillingInterval>('month')
  const { busy, error, manage: changeViaPortal } = useBillingPortal(actions?.portal)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const checkoutLock = useRef(false)
  const t = useTranslations('appBilling')
  const locale = useLocale()
  const intlLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US'

  const paidCurrent = currentPlan !== 'free'
  // The inset white card: the plan in force, or — for a free workspace — the first paid tier.
  const featuredTier: PlanTier = paidCurrent ? currentPlan : 'basic'
  const headingId = useId()

  function acquireCheckout() {
    if (checkoutLock.current) return false
    checkoutLock.current = true
    setCheckoutBusy(true)
    return true
  }
  function releaseCheckout() {
    checkoutLock.current = false
    setCheckoutBusy(false)
  }

  return (
    <section id="plans" className={s.section} aria-labelledby={headingId}>
      <div className={s.head}>
        <h2 id={headingId} className={s.title}>{t('planCards.title')}</h2>
        {yearlyAvailable ? (
          <div className={`dx-segmented ${s.toggle}`} role="group" aria-label={t('planCards.title')}>
            <button
              type="button"
              className={s.toggleBtn}
              data-active={interval === 'month'}
              aria-pressed={interval === 'month'}
              disabled={checkoutBusy || busy}
              onClick={() => setInterval('month')}
            >
              {t('planCards.monthly')}
            </button>
            <button
              type="button"
              className={s.toggleBtn}
              data-active={interval === 'year'}
              aria-pressed={interval === 'year'}
              disabled={checkoutBusy || busy}
              onClick={() => setInterval('year')}
            >
              {t('planCards.yearly')}
            </button>
          </div>
        ) : null}
      </div>

      {!billingConfigured ? <p className={s.notice}>{t('planCards.notConfigured')}</p> : null}
      {yearlyAvailable && interval === 'year' ? <p className={s.notice}>{t('planCards.billedYearly')}</p> : null}
      {error ? <p className={s.error} role="alert">{error}</p> : null}

      <div className={s.grid}>
        {PLAN_ORDER.map((tier) => {
          const limits = PLAN_LIMITS[tier]
          const price = PLAN_PRICE_USD[tier]
          const isCurrent = tier === currentPlan
          const featured = tier === featuredTier
          // Value units in strategy order: monitoring first, questions last (fair use).
          const cadenceSec = effectiveCheckInterval(limits.alert_min_check_interval)
          const cadence =
            cadenceSec >= 3600
              ? t('cadence.hours', { n: Math.round(cadenceSec / 3600) })
              : t('cadence.minutes', { n: Math.round(cadenceSec / 60) })
          const features: Array<[string, string]> = [
            [t('usage.alerts'), formatLimit(limits.alerts_per_org, t('unlimited'), intlLocale)],
            [t('cadence.label'), cadence],
            [t('usage.connections'), formatLimit(limits.database_connections, t('unlimited'), intlLocale)],
            [t('usage.members'), formatLimit(limits.team_members, t('unlimited'), intlLocale)],
            [t('usage.dashboards'), formatLimit(limits.dashboards, t('unlimited'), intlLocale)],
            [t('usage.queries'), formatLimit(limits.queries_per_month, t('unlimited'), intlLocale)],
          ]
          return (
            <article key={tier} data-plan={tier} className={s.card} data-featured={featured} data-current={isCurrent}
              aria-labelledby={`${headingId}-${tier}`}>
              <div className={s.badgeSlot}>
                {isCurrent ? <span className="dx-badge dx-badge-clay">{t('planCards.current')}</span>
                  : featured ? <span className="dx-badge dx-badge-bloom">{t('planCards.recommended')}</span> : null}
              </div>
              <h3 id={`${headingId}-${tier}`} className={s.cardName}>{t(`plans.${tier}`)}</h3>
              <p className={s.cardPrice}>
                <span className={s.priceValue}>${price}</span>
                <span className={s.cardPer}>{t('perMonth')}</span>
              </p>
              <dl className={s.featList}>
                {features.map(([label, value]) => (
                  <div key={label} className={s.feat}>
                    <dt className={s.featLabel}>{label}</dt>
                    <dd className={s.featVal}>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className={s.cardCta}>
                {isCurrent ? (
                  <button type="button" className="dx-btn-ghost" disabled>
                    {t('planCards.current')}
                  </button>
                ) : paidCurrent ? (
                  <button
                    type="button"
                    className="dx-btn-ghost"
                    onClick={changeViaPortal}
                    disabled={busy || !billingConfigured}
                  >
                    {busy ? t('opening') : t('planCards.changeViaPortal')}
                  </button>
                ) : tier === 'free' ? null : billingConfigured ? (
                  <CheckoutButton plan={tier} interval={interval} className={featured ? 'dx-btn' : 'dx-btn-ghost'} actions={actions?.checkout}
                    disabled={checkoutBusy} acquire={acquireCheckout} release={releaseCheckout}>
                    {t('planCards.choose')}
                  </CheckoutButton>
                ) : (
                  <button type="button" className={featured ? 'dx-btn' : 'dx-btn-ghost'} disabled>
                    {t('planCards.choose')}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {/* staff-only $1 live-checkout test — hidden while a paid sub is live (a second
          checkout would double-subscribe; use the portal instead) */}
      {adminTestAvailable && !paidCurrent ? (
        <div className={s.adminTest}>
          <div className={s.adminTestText}>
            <span className={s.adminTestTitle}>{t('planCards.adminTestTitle')}</span>
            <span className={s.adminTestDesc}>{t('planCards.adminTestDesc')}</span>
          </div>
          <CheckoutButton plan="admin_test" className="dx-btn-ghost" actions={actions?.checkout}
            disabled={checkoutBusy} acquire={acquireCheckout} release={releaseCheckout}>
            {t('planCards.adminTestCta')}
          </CheckoutButton>
        </div>
      ) : null}
    </section>
  )
}
