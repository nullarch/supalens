import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import LogoMark from '@/components/brand/LogoMark'
import '@/components/landing/editorial/editorial.css'
import { editorialFontVariables } from '@/components/landing/editorial/fonts'
import { isSelfHosted } from '@/config/edition'
import s from '../login/login.module.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * Where a signed-in account lands when it belongs to no workspace on a self-hosted install
 * (a removed member, typically). There is nothing for it to open; it can only sign out.
 */
export default async function NoWorkspacePage() {
  if (!isSelfHosted()) notFound()
  const t = await getTranslations('appAuth')
  return (
    <main className={`ed ${editorialFontVariables}`}>
      <div className={s.page}>
        <header className={`${s.row} ${s.header}`}>
          <span className={s.brand}>
            <LogoMark size={20} />
            <span className={s.wordmark}>Supalens</span>
          </span>
        </header>
        <div className={`${s.row} ${s.shell}`}>
          <section className={s.card} aria-labelledby="no-workspace-title">
            <h1 id="no-workspace-title" className={s.title}>{t('noWorkspace.title')}</h1>
            <p className={s.subtitle}>{t('noWorkspace.body')}</p>
            <form action="/auth/signout" method="post" className={s.form}>
              <button type="submit" className="ed-button">{t('noWorkspace.signOut')}</button>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
