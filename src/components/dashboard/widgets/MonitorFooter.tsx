'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import type { GridWidget } from './DashboardGrid'
import { widgetTimestamp } from './presentation'
import { BaseModal } from '@/components/modals/base-modal'
import s from './DashboardGrid.module.css'

/** Recorded linkage only: this payload cannot establish current query health. */
export function MonitorFooter({ widget }: { widget: GridWidget }) {
  const t = useTranslations('appDashboards')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const m = widget.monitor
  const def = widget.definition
  if (!m) return null
  const firing = m.enabled && m.status === 'firing'
  const tone = !m.enabled ? 'paused' : firing ? 'incident' : 'watching'
  const label = !m.enabled ? t('monitor.paused') : firing ? t('monitor.incident') : t('monitor.watching')
  const recorded = widgetTimestamp(m.lastCheckedAt, locale)
  const askHref = `/app/ask?q=${encodeURIComponent(t('monitor.askQuestion', { title: widget.spec.title ?? '' }))}`
  const incidentHref = m.openIncidentEventId ? `/app/incidents/${m.openIncidentEventId}` : null
  return <>
    <div className={s.mRow}>
      <div className={s.mSummary}>
        <span className={s.mStatus} data-tone={tone}><span className={s.mDot} aria-hidden />{label}</span>
        <span className={s.mCheckedCompact}>{recorded
          ? <time dateTime={recorded.iso} title={t('monitor.checkedAt', { time: recorded.label })} aria-label={t('monitor.checkedAt', { time: recorded.label })}>{recorded.iso.slice(5, 16).replace('T', ' ')} UTC</time>
          : t(m.lastCheckedAt ? 'widget.timeUnavailable' : 'monitor.checkedNever')}</span>
      </div>
      <Link className={`${s.mLink} ${s.mPrimary}`} href={incidentHref ?? `/app/monitors/${m.alertId}`} aria-label={t(incidentHref ? 'monitor.viewIncident' : 'monitor.viewMonitor')} title={t(incidentHref ? 'monitor.viewIncident' : 'monitor.viewMonitor')}>
        <span>{t(incidentHref ? 'monitor.viewIncident' : 'monitor.viewMonitor')}</span>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden><path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Link>
      <button ref={trigger} type="button" className={s.mDefSummary} aria-label={t('monitor.details')} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" /><path d="M10 9v5m0-8v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </div>
    <BaseModal open={open} onClose={() => setOpen(false)} title={t('monitor.details')} description={widget.spec.title}
      onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}>
      <div className={s.mDetails}>
        <span className={s.mStatus} data-tone={tone}><span className={s.mDot} aria-hidden />{label}</span>
        <span className={s.mChecked}>{recorded
          ? <time dateTime={recorded.iso}>{t('monitor.checkedAt', { time: recorded.label })}</time>
          : t(m.lastCheckedAt ? 'widget.timeUnavailable' : 'monitor.checkedNever')}</span>
        <span className={s.mLinks}>
          {incidentHref && <Link className={s.mLink} href={incidentHref}>{t('monitor.viewIncident')}</Link>}
          <Link className={s.mLink} href={`/app/monitors/${m.alertId}`}>{t('monitor.viewMonitor')}</Link>
          <Link className={s.mLink} href={askHref}>{t('monitor.askChange')}</Link>
        </span>
        <h3>{t('monitor.definition')}</h3>
        <p className={s.mDefText}>{def?.description || t('monitor.noDefinition')}</p>
        <ul className={s.mEvidence}>
          {def?.evidence.map((e, index) => <li key={`${e.ref}-${index}`}>
            <code>{e.ref}</code>{e.note && <p>{e.note}</p>}
          </li>)}
        </ul>
      </div>
    </BaseModal>
  </>
}
