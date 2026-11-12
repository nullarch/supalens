'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  checklistHidden,
  checklistHideKey,
  checklistItems,
  checklistProgress,
  checklistSignature,
  showChecklist,
} from '@/lib/activation/checklist'
import { ACTIVATION_MIN_KPIS, ACTIVATION_MIN_MONITORS, type ActivationState, type ActivationStep } from '@/lib/activation/logic'
import { useIntegrations } from '@/components/integrations/IntegrationsContext'
import { connectDatabaseHref } from '@/lib/integrations/types'
import s from './setup-checklist.module.css'

/* ============================================================
   The ONE onboarding surface: a compact checklist on the home screen.

   It never covers the page (no modal, no full-screen gate), every step carries its own
   direct CTA so nothing is gated behind another step, and the recommendations sit in a
   quieter group below. Server state decides whether it renders at all — an activated
   workspace never sees it, and a regression brings it straight back. The per-browser
   "hide" is keyed to the exact state it hid (checklistSignature), so it is a snooze, not
   a permanent dismissal.
   ============================================================ */

export interface SetupChecklistProps {
  orgId: string
  activation: ActivationState
  /** The first real data source — what the repo/KPI steps act on (null before one exists). */
  sourceId: string | null
  /** KPI review href for that source; the page owns the URL shape. */
  kpiHref: string | null
  /** Viewers read the checklist but never act on it. */
  canManage: boolean
}

const Check = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
)

export function SetupChecklist({ orgId, activation, sourceId, kpiHref, canManage }: SetupChecklistProps) {
  const t = useTranslations('appOverview.setup')
  const integrations = useIntegrations()
  const [hidden, setHidden] = useState(false)

  const key = checklistHideKey(orgId)
  const signature = checklistSignature(activation)

  // Render on the server and hide after the read, so the guide is visible without JS and a
  // snoozed browser only flickers it. A changed signature makes the stored value stop matching.
  useEffect(() => {
    try {
      setHidden(checklistHidden(localStorage.getItem(key), activation))
    } catch {
      setHidden(false) // storage blocked: the checklist simply stays visible
    }
  }, [key, signature]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!showChecklist(activation) || hidden) return null

  const items = checklistItems(activation)
  const { done, total } = checklistProgress(activation)

  const hrefFor = (step: ActivationStep): string => {
    switch (step) {
      case 'db_connected':
        return connectDatabaseHref(integrations)
      case 'repo_attached':
        return sourceId ? `/app/sources?attach=${sourceId}` : '/app/sources'
      case 'understanding_generated':
      case 'kpis_extracted':
        return '/app/setup'
      case 'kpis_approved':
      case 'monitors_active':
        return kpiHref ?? '/app/sources'
      case 'notifications_configured':
        return '/app/settings/notifications'
    }
  }
  const titleFor = (step: ActivationStep) =>
    step === 'kpis_approved'
      ? t('step.kpis_approved', { need: ACTIVATION_MIN_KPIS })
      : step === 'monitors_active'
        ? t('step.monitors_active', { need: ACTIVATION_MIN_MONITORS })
        : t(`step.${step}`)

  function hide() {
    try {
      localStorage.setItem(key, signature)
    } catch {
      /* storage blocked — hide for this view only */
    }
    setHidden(true)
  }

  const required = items.filter((item) => !item.optional)
  // Attaching code needs the GitHub App; without it the suggestion would lead nowhere.
  const suggested = items.filter((item) => item.optional && (integrations.github || item.step !== 'repo_attached'))

  const row = (item: (typeof items)[number]) => (
    <li
      key={item.step}
      className={s.row}
      data-state={item.done ? 'done' : item.current ? 'current' : 'todo'}
      data-optional={item.optional || undefined}
      aria-current={item.current ? 'step' : undefined}
    >
      <span className={s.marker} aria-hidden>{item.done ? <Check /> : null}</span>
      <span className={s.rowTitle}>{titleFor(item.step)}</span>
      {item.done && <span className={s.srOnly}> · {t('doneLabel')}</span>}
      {item.current && <span className={`dx-badge ${s.badge}`}>{t('nextBadge')}</span>}
      {item.optional && <span className={`dx-badge ${s.badge}`}>{t('optional')}</span>}
      {!item.done && canManage && (
        <Link href={hrefFor(item.step)} className={`dx-btn-ghost dx-btn-sm ${s.rowCta}`}>
          {t(`cta.${item.step}`)}
        </Link>
      )}
    </li>
  )

  return (
    <section className={s.panel} aria-labelledby="setup-checklist-title">
      <div className={s.head}>
        <h2 id="setup-checklist-title" className={s.title}>{t('stepsTitle')}</h2>
        <span className={s.progress}>{t('progress', { done, total })}</span>
        <div className={s.headActions}>
          <Link href="/app/setup" className="dx-text-link">{t('details')}</Link>
          <button type="button" className={s.hide} onClick={hide}>{t('hide')}</button>
        </div>
      </div>
      <p className={s.lede}>{t('lede')}</p>
      <ol className={s.list}>{required.map(row)}</ol>
      {suggested.length > 0 && (
        <div className={s.suggested}>
          <p className={s.suggestedNote}>{t('optionalNote')}</p>
          <ol className={s.list}>{suggested.map(row)}</ol>
        </div>
      )}
      {!canManage && <p className={s.viewerNote}>{t('viewerNote')}</p>}
    </section>
  )
}
