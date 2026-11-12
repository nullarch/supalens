import { getLocale, getTranslations } from 'next-intl/server'
import { FallbackSurface } from '@/components/feedback/FallbackSurface'
import { FALLBACK_COPY, fallbackHome, type FallbackLocale } from '@/components/feedback/fallback-copy'

/** Public unknown routes use the same brand without an authenticated app link. */
export default async function NotFound() {
  const resolved = await getLocale()
  const locale: FallbackLocale = resolved === 'ko' || resolved === 'ja' ? resolved : 'en'
  const t = await getTranslations('appChrome.notFound')
  const home = { href: fallbackHome(locale), label: FALLBACK_COPY[locale].home }
  return <main><FallbackSurface code="404" title={t('body')} description={t('publicHint')} home={home}>
    <a href={home.href} className="sl-fallback-action sl-fallback-primary">{home.label}</a>
  </FallbackSurface></main>
}
