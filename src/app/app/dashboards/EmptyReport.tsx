'use client'

import Link from 'next/link'
import { useId } from 'react'
import { useTranslations } from 'next-intl'
import s from './overview.module.css'

/** An existing report without widgets, never a fabricated sample dashboard: the design-system empty
 * state — centered in the card, a 14px title, one muted line and the primary action. */
export function EmptyReport() {
  const t = useTranslations('appDashboards')
  const titleId = useId()
  return <section className={s.boardEmpty} aria-labelledby={titleId}>
    <h2 id={titleId}>{t('boardEmptyTitle')}</h2>
    <p>{t.rich('boardEmpty', { link: chunks => <span className={s.boardEmptyRef}>{chunks}</span> })}</p>
    <Link href="/app/ask" className="dx-btn">{t('list.goAnalyze')}</Link>
  </section>
}
