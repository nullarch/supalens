import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import LogoMark from '@/components/brand/LogoMark'
import { SavedAnswerBody } from './SavedAnswerBody'
import type { SavedResult } from './saved-analysis'
import { isCloud } from '@/config/edition'
import s from './saved-analysis.module.css'

/** Public persisted output only; no share creation, query, or report action. */
export async function SharedAnswer({ question, result }: { question: string; result: SavedResult | null }) {
  const t = await getTranslations('appAsk')
  const locale = await getLocale()
  const homeHref = !isCloud() ? '/app' : locale === 'en' ? '/' : `/${locale}`
  return <main className={`${s.page} ${s.answerPage} ${s.publicPage}`}>
    <div className={s.meta}><Link className={s.brand} href={homeHref}><LogoMark size={28} />supalens</Link><span>{t('shared.label')}</span></div>
    <h1 className={s.title}>{question}</h1>
    <p className={s.note}>{t('run.snapshot')}</p>
    <SavedAnswerBody result={result} />
    <footer className={s.footer}>{t.rich('shared.footer', { link: chunks => <Link href={homeHref}>{chunks}</Link> })}</footer>
  </main>
}
