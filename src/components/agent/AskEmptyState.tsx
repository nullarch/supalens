import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import s from './AskEmptyState.module.css'

/** Real zero-source state; never substitutes sample data or starts provisioning.
 *  The page's title row (serif title + history), then the empty state centered in a card. */
export async function AskEmptyState() {
  const t = await getTranslations('appAsk')
  return <section className={s.empty} aria-labelledby="ask-empty-title">
    <div className={s.head}>
      <h1 id="ask-empty-title" className={s.title}>{t('title')}</h1>
      <Link href="/app/ask/history" className={`dx-btn-ghost ${s.secondary}`}>{t('historyLink')}</Link>
    </div>
    <div className={s.card} data-empty-card>
      <p className={s.lead}>{t('empty.noSources')}</p>
      <p className={s.line}>{t('lede')}</p>
      <Link href="/app/sources" className={`dx-btn ${s.primary}`}>{t('empty.connectCta')}</Link>
    </div>
  </section>
}
