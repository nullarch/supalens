'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import s from './Skeleton.module.css'

/** A single localized announcement; decorative shapes never become fake tables
 * or empty landmarks in the accessibility tree. Server components remain children. */
export function LoadingFrame({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const t = useTranslations('appChrome')
  return <div className={s.loadingFrame} data-loading-frame>
    <p className={s.loadingAnnouncement} role="status">{t('loading')}</p>
    <div className={s.loadingShapes} aria-hidden="true" aria-busy="true" style={style}>{children}</div>
  </div>
}
