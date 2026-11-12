'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { FallbackSurface } from './FallbackSurface'

export function AppErrorContent({ reset }: { reset: () => void }) {
  const t = useTranslations('appChrome')
  return <FallbackSurface title={t('error.title')} description={t('error.body')}>
    <button className="sl-fallback-action sl-fallback-primary" type="button" onClick={reset}>{t('error.retry')}</button>
    <Link className="sl-fallback-action" href="/app/overview" prefetch={false}>{t('error.overview')}</Link>
  </FallbackSurface>
}
