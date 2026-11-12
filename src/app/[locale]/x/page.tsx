import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Check } from 'lucide-react'

import '@/components/landing/editorial/editorial.css'
import { editorialFontVariables } from '@/components/landing/editorial/fonts'
import Footer from '@/components/landing/editorial/Footer'
import Header from '@/components/landing/editorial/Header'
import RevealOnScroll from '@/components/landing/editorial/RevealOnScroll'
import { Link } from '@/i18n/navigation'
import { publicAlternates } from '@/lib/metadata/public-origin'
import { displayGrade } from '@/lib/xray/schema'
import { recentReports, type RecentXray } from '@/lib/xray/service'
import LiveReplay from './LiveReplay'
import XrayForm from './XrayForm'
import s from './x.module.css'

// The gallery reads succeeded reports; five minutes of staleness is fine for a landing page.
export const revalidate = 300

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'xray' })
  const title = t('metaTitle')
  const description = t('metaDescription')
  return {
    title,
    description,
    alternates: publicAlternates(locale, '/x'),
    openGraph: { title, description, type: 'website', siteName: 'Supalens' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

type Item = { title: string; body: string }
type Step = { kicker: string; title: string; body: string }

export default async function XrayLandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('xray.landing')

  let recent: RecentXray[] = []
  try {
    recent = await recentReports(8)
  } catch {
    recent = []
  }
  const examples = recent.slice(0, 3).map((r) => r.fullName)
  const trust = t.raw('trust') as string[]
  const items = t.raw('get.items') as Item[]
  const flow = t.raw('get.flow') as string[]
  const kpis = t.raw('get.kpis') as string[]
  const steps = t.raw('band.steps') as Step[]

  return (
    <main className={`ed ${editorialFontVariables} ${s.page}`}>
      <RevealOnScroll />
      <Header sectionBase="/" />

      <section className={s.hero} aria-labelledby="xray-title">
        <div className={`ed-wide ${s.heroGrid}`}>
          <div className={s.heroCopy}>
            <div className={s.tagRow}>
              <span className={s.tag}>{t('tag')}</span>
              <span className={s.tagNote}>{t('tagNote')}</span>
            </div>
            <h1 id="xray-title" className={s.title}>
              {t('title')}
            </h1>
            <p className={s.sub}>{t('sub')}</p>
            <div id="scan" className={s.formWrap}>
              <XrayForm examples={examples} labelHidden />
            </div>
            <ul className={s.trust}>
              {trust.map((item) => (
                <li key={item}>
                  <Check size={16} strokeWidth={2.4} aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <LiveReplay />
        </div>
      </section>

      <section className={s.section} aria-labelledby="xray-get">
        <div className="ed-wide">
          <h2 id="xray-get" className={s.sectionTitle}>
            {t('get.title')}
          </h2>
          <div className={s.getGrid}>
            <article className={s.getCard} data-reveal>
              <div className={s.getVisual} aria-hidden>
                <div className={s.flow}>
                  {flow.map((step, index) => (
                    <span key={step} className={s.flowItem}>
                      <span className={index === flow.length - 1 ? s.flowTrap : s.flowNode}>{step}</span>
                      {index < flow.length - 1 && <span className={s.flowArrow}>→</span>}
                    </span>
                  ))}
                </div>
              </div>
              <h3 className={s.getTitle}>{items[0]?.title}</h3>
              <p className={s.getBody}>{items[0]?.body}</p>
            </article>
            <article className={s.getCard} data-reveal>
              <div className={`${s.getVisual} ${s.getVisualCode}`} aria-hidden>
                <span className={s.diffGood}>{t('get.diffGood')}</span>
                <span className={s.diffBad}>{t('get.diffBad')}</span>
              </div>
              <h3 className={s.getTitle}>{items[1]?.title}</h3>
              <p className={s.getBody}>{items[1]?.body}</p>
            </article>
            <article className={s.getCard} data-reveal>
              <div className={`${s.getVisual} ${s.getVisualChips}`} aria-hidden>
                {kpis.map((kpi) => (
                  <span key={kpi} className={s.kpiChip}>
                    {kpi}
                  </span>
                ))}
              </div>
              <h3 className={s.getTitle}>{items[2]?.title}</h3>
              <p className={s.getBody}>{items[2]?.body}</p>
            </article>
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className={s.section} aria-labelledby="xray-recent">
          <div className="ed-wide">
            <div className={s.sectionHead}>
              <div>
                <h2 id="xray-recent" className={s.sectionTitle}>
                  {t('recent.title')}
                </h2>
                <p className={s.sectionNote}>{t('recent.note')}</p>
              </div>
            </div>
            <ul className={s.recentGrid}>
              {recent.map((item) => (
                <li key={`${item.owner}/${item.repo}`}>
                  <Link href={`/x/${item.owner}/${item.repo}`} className={s.recentCard}>
                    <span className={s.recentHead}>
                      <span className={s.recentRepo}>{item.fullName}</span>
                      <span className={s.recentGrade}>{displayGrade(item.grade)}</span>
                    </span>
                    <span className={s.recentLine}>{item.headline}</span>
                    <span className={s.recentMeta}>
                      {t('recent.traps', { count: item.traps })} · {t('recent.kpis', { count: item.kpis })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className={`${s.section} ${s.sectionLast}`} aria-labelledby="xray-band">
        <div className="ed-wide">
          <div className={s.band}>
            <div className={s.bandHead}>
              <div className={s.bandCopy}>
                <h2 id="xray-band" className={s.bandTitle}>
                  {t('band.title')}
                </h2>
                <p className={s.bandBody}>{t('band.body')}</p>
              </div>
              <a href="#scan" className={s.bandCta}>
                {t('band.cta')}
              </a>
            </div>
            <ol className={s.steps}>
              {steps.map((step, index) => (
                <li key={step.title} className={index === 0 ? `${s.step} ${s.stepNow}` : s.step}>
                  <span className={s.stepKicker}>{step.kicker}</span>
                  <span className={s.stepTitle}>{step.title}</span>
                  <span className={s.stepBody}>{step.body}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <Footer sectionBase="/" />
    </main>
  )
}
