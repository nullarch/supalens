'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { ActivationStep } from '@/lib/activation/logic'
import s from './SetupPill.module.css'

const DISMISS_KEY = 'supalens.setupPill.dismissed'

/** The steps the pill shows, in Golden-Path order. `notifications_configured` is deliberately
 *  absent: email delivery always exists, so it can never be the thing still blocking a user. */
const PILL_STEPS = [
  { step: 'db_connected', labelKey: 'pill.connect' },
  { step: 'repo_attached', labelKey: 'pill.repo', optional: true },
  { step: 'understanding_generated', labelKey: 'pill.understand' },
  { step: 'kpis_approved', labelKey: 'pill.kpi' },
  { step: 'monitors_active', labelKey: 'pill.monitors' },
] as const satisfies ReadonlyArray<{ step: ActivationStep; labelKey: string; optional?: boolean }>

/**
 * "Continue setup" pill: one slim tinted row carrying the org's remaining activation steps as
 * numbered stops, reading the SAME state /app/setup does (`lib/activation`).
 *
 * NO LONGER SHIPPED on /app/ask — the app has exactly one onboarding surface, the home checklist
 * (app/overview/SetupChecklist), and a second list on the chat page was one of the competing
 * guides that suppressed it. Kept for the /dev/wizard and /dev/analysis design previews.
 */
export function SetupPill({
  steps,
  nextStep,
}: {
  steps: Record<ActivationStep, boolean>
  /** First incomplete step; null when the workspace is activated (the pill hides). */
  nextStep: ActivationStep | null
}) {
  const t = useTranslations('appOnboarding')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) setDismissed(true)
    } catch {
      /* localStorage unavailable — stay visible */
    }
  }, [])

  if (!nextStep || dismissed) return null

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore — still hide for this session */
    }
    setDismissed(true)
  }

  return (
    <section className={s.guide} aria-label={t('pill.guideLabel')}>
      <ol className={s.steps}>
      {PILL_STEPS.map(({ step, labelKey, ...rest }, index) => {
        const done = steps[step]
        const optional = 'optional' in rest && rest.optional === true
        return (
          <li key={step} className={s.step} aria-current={nextStep === step ? 'step' : undefined} data-done={done}>
            <span aria-hidden className={s.indicator}>
              {done ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              ) : (
                String(index + 1).padStart(2, '0')
              )}
            </span>
            <span className={s.label}>
              {t(labelKey)}
            </span>
            {done && <span className="sr-only"> · {t('pill.done')}</span>}
            {optional && !done && <span className={s.optional}>({t('pill.optional')})</span>}
          </li>
        )
      })}
      </ol>
      <div className={s.actions}>
      <Link href="/app/setup" className={s.continue}>
        {t('pill.continueCta')}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('pill.dismiss')}
        className={s.dismiss}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      </div>
    </section>
  )
}
