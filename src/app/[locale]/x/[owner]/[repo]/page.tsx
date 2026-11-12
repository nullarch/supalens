import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound, permanentRedirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import '@/components/landing/editorial/editorial.css'
import { editorialFontVariables } from '@/components/landing/editorial/fonts'
import Footer from '@/components/landing/editorial/Footer'
import Header from '@/components/landing/editorial/Header'
import { publicOrigin } from '@/lib/metadata/public-origin'
import { parseRepoInput } from '@/lib/xray/repo-ref'
import { displayGrade } from '@/lib/xray/schema'
import { getRepoState } from '@/lib/xray/service'
import ReportView from './ReportView'
import RescanButton from './RescanButton'
import ScanView from './ScanView'
import s from './report.module.css'

// Reads the live scan state on every request (a scan can finish at any moment).
export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string; owner: string; repo: string }>

function localizedPath(locale: string, path: string): string {
  return locale === 'en' ? path : `/${locale}${path}`
}

/** The share card, pinned to one report version (see src/app/x-card/[owner]/[repo]/route.ts). */
function cardPath(owner: string, repo: string, reportId: string, locale: string): string {
  return `/x-card/${owner}/${repo}?v=${reportId}${locale === 'en' ? '' : `&locale=${locale}`}`
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, owner, repo } = await params
  const ref = parseRepoInput(`${owner}/${repo}`)
  if (!ref) return {}
  const t = await getTranslations({ locale, namespace: 'xray' })
  const state = await getRepoState(ref.owner, ref.repo, locale)
  const report = state.report?.report
  const fullName = state.report?.fullName ?? state.inflight?.fullName ?? `${ref.owner}/${ref.repo}`
  const title = report ? t('report.metaTitle', { repo: fullName, grade: displayGrade(report.grade) }) : t('metaTitle')
  const description = report ? report.headline : t('metaDescription')
  const images = state.report && report
    ? [{ url: `${publicOrigin()}${cardPath(ref.owner, ref.repo, state.report.id, locale)}`, width: 1200, height: 630, alt: title }]
    : undefined
  return {
    title,
    description,
    // Reports describe third-party public repos on request; keep them out of search indexes
    // until owners have a self-serve way to hide them. Sharing (OG cards) is unaffected.
    robots: { index: false, follow: true },
    alternates: { canonical: `${publicOrigin()}${localizedPath(locale, `/x/${ref.owner}/${ref.repo}`)}` },
    openGraph: { title, description, type: 'article', siteName: 'Supalens', images },
    twitter: { card: 'summary_large_image', title, description, images },
  }
}

export default async function XrayRepoPage({ params }: { params: Params }) {
  const { locale, owner, repo } = await params
  setRequestLocale(locale)
  const ref = parseRepoInput(`${owner}/${repo}`)
  if (!ref) notFound()
  if (ref.owner !== owner || ref.repo !== repo) permanentRedirect(localizedPath(locale, `/x/${ref.owner}/${ref.repo}`))

  const t = await getTranslations('xray.report')
  const state = await getRepoState(ref.owner, ref.repo, locale)
  const path = localizedPath(locale, `/x/${ref.owner}/${ref.repo}`)
  const pageUrl = `${publicOrigin()}${path}`
  const label = `${ref.owner}/${ref.repo}`

  let body: ReactNode
  if (state.inflight) {
    body = <ScanView scanId={state.inflight.id} fullName={state.inflight.fullName} branch={state.inflight.defaultBranch ?? 'main'} />
  } else if (state.report?.report) {
    const row = state.report
    body = (
      <ReportView
        model={{
          owner: row.owner,
          repo: row.repo,
          fullName: row.fullName,
          defaultBranch: row.defaultBranch,
          commitSha: row.commitSha,
          completedAt: row.completedAt,
          report: row.report!,
        }}
        pageUrl={pageUrl}
        cardUrl={cardPath(row.owner, row.repo, row.id, locale)}
      />
    )
  } else {
    const failed = Boolean(state.lastFailed)
    body = (
      <section className={`ed-wide ${s.state}`}>
        <h1 className={s.stateTitle}>{failed ? t('failed.title', { repo: label }) : t('empty.title', { repo: label })}</h1>
        {!failed && <p className={s.stateBody}>{t('empty.body')}</p>}
        <RescanButton repo={label} label={failed ? t('failed.cta') : t('empty.cta')} />
      </section>
    )
  }

  return (
    <main className={`ed ${editorialFontVariables} ${s.page}`}>
      <Header sectionBase="/" />
      {body}
      <Footer sectionBase="/" />
    </main>
  )
}
