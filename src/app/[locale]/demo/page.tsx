import type { Metadata } from 'next'
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { BellRing, Check, CircleAlert } from 'lucide-react'

import '@/components/landing/editorial/editorial.css'
import { editorialFontVariables } from '@/components/landing/editorial/fonts'
import RevealOnScroll from '@/components/landing/editorial/RevealOnScroll'
import Header from '@/components/landing/editorial/Header'
import FinalCta from '@/components/landing/editorial/FinalCta'
import Footer from '@/components/landing/editorial/Footer'
import { WidgetRenderer } from '@/components/dashboard/widgets'
import { DEMO_KPI_PROPOSALS } from '@/lib/kpi/demo-catalog'
import { DEMO_BOARD_KEYS, getDemoBoard, type DemoBoard } from '@/lib/demo/board'
import { demoRunsPerVisitorPerDay, normalizeDemoQuestion, publicDemoConfigured, publicDemoOrgId } from '@/lib/demo/public-demo'
import { findCachedDemoAnswer } from '@/lib/demo/service'
import { publicAlternates } from '@/lib/metadata/public-origin'
import { AskButton } from './AskButton'
import DemoConsole from './DemoConsole'
import type { DemoPreloadedAnswer, DemoSuggestion } from './demo-types'
import s from './DemoPage.module.css'

// The no-signup live demo (docs/public-demo-plan.md) in the editorial system: a real read-only
// analyst console over the rolling demo store, the problems hidden in its data, how answers stay
// checkable, and the answer → monitor → alert → KPI board path. The board and the recent answers
// to suggested questions are read at render time, so the page refreshes hourly.
export const revalidate = 3600

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'demo' })
  const title = t('metaTitle')
  const description = t('metaDescription')
  return {
    title,
    description,
    alternates: publicAlternates(locale, '/demo'),
    openGraph: { title, description, type: 'website', siteName: 'Supalens' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** Recent live answers for the suggested questions, so they open instantly without an API call. */
async function preloadAnswers(suggestions: DemoSuggestion[]): Promise<Record<string, DemoPreloadedAnswer>> {
  const orgId = publicDemoOrgId()
  if (!orgId || !publicDemoConfigured()) return {}
  const entries = await Promise.all(
    suggestions.map(async ({ question }) => {
      const q = normalizeDemoQuestion(question)
      try {
        const cached = await findCachedDemoAnswer(orgId, q)
        return cached?.result ? ([q, { result: cached.result, answeredAt: cached.answeredAt }] as const) : null
      } catch {
        return null
      }
    }),
  )
  return Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null))
}

/** Catalog chart spec with this render's rows and localized chrome. */
function boardSpec(board: DemoBoard, key: string, title: string, columnLabels: Record<string, string>): unknown {
  const proposal = DEMO_KPI_PROPOSALS.find((p) => p.key === key)
  const sample = board.samples[key]
  if (!proposal || !sample) return null
  const chart: Record<string, unknown> = { ...proposal.vizSpec.chart, title }
  delete chart.caption
  delete chart.description
  if (Array.isArray(chart.columns)) {
    chart.columns = (chart.columns as { key: string; label?: string }[]).map((column) => ({
      ...column,
      label: columnLabels[column.key] ?? column.label,
    }))
  }
  return { ...proposal.vizSpec, sample, chart }
}

export default async function DemoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('demo')
  const format = await getFormatter()

  const configured = publicDemoConfigured() && Boolean(process.env.TRIGGER_SECRET_KEY)
  const suggestions = t.raw('suggestions') as DemoSuggestion[]
  const [board, preloaded] = await Promise.all([getDemoBoard(), preloadAnswers(suggestions)])

  const stories = t.raw('stories.items') as { kicker: string; title: string; body: string; question: string }[]
  const trust = t.raw('trust.items') as { kicker: string; title: string; body: string }[]
  const monitorRows = t.raw('next.monitor.rows') as [string, string][]
  const columnLabels = t.raw('next.board.columns') as Record<string, string>
  const boardSpecs = DEMO_BOARD_KEYS.map((key) => ({ key, spec: boardSpec(board, key, t(`payoffTitles.${key}`), columnLabels) }))

  return (
    <main className={`ed ${editorialFontVariables}`}>
      <RevealOnScroll />
      <Header sectionBase="/" />

      <section className={s.hero} aria-labelledby="demo-title">
        <div className={`ed-container ${s.intro}`}>
          <span className="ed-tag ed-tag--bloom">
            <span className={s.liveDot} aria-hidden />
            {t('tag')}
          </span>
          <h1 id="demo-title" className={s.title}>
            {t('title')}
          </h1>
          <p className={s.sub}>{t('sub')}</p>
          <ul className={s.facts}>
            <li>{t('facts.tables')}</li>
            {board.customers !== null && <li>{t('facts.customers', { count: format.number(board.customers) })}</li>}
            {board.orders !== null && <li>{t('facts.orders', { count: format.number(board.orders) })}</li>}
            <li>{t('facts.current')}</li>
            <li>{t('facts.readOnly')}</li>
          </ul>
        </div>

        <div className={`ed-wide ${s.stage}`}>
          <div className="ed-film" aria-hidden />
          <DemoConsole
            configured={configured}
            suggestions={suggestions}
            preloaded={preloaded}
            tables={board.tables}
            liveLimit={demoRunsPerVisitorPerDay()}
          />
        </div>
      </section>

      <section className="ed-section" aria-labelledby="demo-stories-title">
        <div className="ed-container" data-reveal>
          <header className="ed-head">
            <span className="ed-tag">{t('stories.tag')}</span>
            <h2 id="demo-stories-title" className="ed-title">
              {t('stories.title')}
            </h2>
            <p className="ed-lede">{t('stories.lede')}</p>
          </header>
          <ul className={`ed-panel ${s.stories}`}>
            {stories.map((story) => (
              <li key={story.kicker} className={s.story}>
                <span className={s.kicker}>{story.kicker}</span>
                <h3 className={s.storyTitle}>{story.title}</h3>
                <p className={s.storyBody}>{story.body}</p>
                <p className={s.storyQuestion}>“{story.question}”</p>
                <AskButton className={`ed-button ed-button--small ${s.storyAsk}`} question={story.question} label={t('stories.ask')} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ed-section" aria-labelledby="demo-trust-title">
        <div className="ed-container" data-reveal>
          <header className="ed-head">
            <span className="ed-tag">{t('trust.tag')}</span>
            <h2 id="demo-trust-title" className="ed-title">
              {t('trust.title')}
            </h2>
          </header>
          <ul className={s.trust}>
            {trust.map((item) => (
              <li key={item.kicker}>
                <span className={s.kicker}>{item.kicker}</span>
                <h3 className={s.trustTitle}>{item.title}</h3>
                <p className={s.trustBody}>{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ed-section" aria-labelledby="demo-next-title">
        <div className="ed-container" data-reveal>
          <header className="ed-head">
            <span className="ed-tag">{t('next.tag')}</span>
            <h2 id="demo-next-title" className="ed-title">
              {t('next.title')}
            </h2>
            <p className="ed-lede">{t('next.lede')}</p>
          </header>

          <div className={s.flow}>
            <div className={`ed-product ${s.monitorCard}`}>
              <p className={s.cardLabel}>
                <span className={s.cardLabelText}>
                  <BellRing size={13} aria-hidden />
                  {t('next.monitor.label')}
                </span>
              </p>
              <p className={s.cardTitle}>{t('next.monitor.title')}</p>
              <dl className={s.monitorRows}>
                {monitorRows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className={`ed-product ${s.alertCard}`}>
              <p className={s.cardLabel}>
                <span className={s.cardLabelText}>supalens · {t('next.alert.channel')}</span>
                <span>{t('next.alert.when')}</span>
              </p>
              <p className={s.cardTitle}>{t('next.alert.title')}</p>
              <div className={s.fact}>
                <p className={s.factLabel}>
                  <Check size={12} aria-hidden />
                  {t('next.alert.confirmedLabel')}
                </p>
                <p>{t('next.alert.confirmed')}</p>
              </div>
              <div className={`${s.fact} ${s.hypothesis}`}>
                <p className={s.factLabel}>
                  <CircleAlert size={12} aria-hidden />
                  {t('next.alert.likelyLabel')}
                </p>
                <p>{t('next.alert.likely')}</p>
              </div>
              <p className={s.cardNote}>{t('next.alert.note')}</p>
            </div>
          </div>

          <div className={`ed-panel ${s.board}`}>
            <div className={s.boardHead}>
              <h3 className={s.boardTitle}>{t('next.board.title')}</h3>
              <p className={s.boardMeta}>
                {board.live && <span className={s.liveDot} aria-hidden />}
                {board.live ? t('next.board.live') : t('next.board.sample')}
                {board.live && board.refreshedAt
                  ? ` · ${t('next.board.updated', {
                      time: format.dateTime(new Date(board.refreshedAt), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
                    })} UTC`
                  : null}
              </p>
            </div>
            <div className={`ed-product ${s.boardGrid}`}>
              {boardSpecs.map(({ key, spec }) =>
                spec ? (
                  <div key={key} className={s[`board_${key}`]}>
                    <WidgetRenderer spec={spec} menu={null} />
                  </div>
                ) : null,
              )}
            </div>
          </div>
        </div>
      </section>

      <FinalCta title={t('cta.title')} note={t('cta.note')} secondary={{ href: '/docs/mcp', label: t('cta.secondary') }} />
      <Footer sectionBase="/" />
    </main>
  )
}
