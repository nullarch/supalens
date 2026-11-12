import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import LogoMark from '@/components/brand/LogoMark'
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher'
import '@/components/landing/editorial/editorial.css'
import { editorialFontVariables } from '@/components/landing/editorial/fonts'
import { isSelfHosted } from '@/config/edition'
import { instanceHasUsers } from '@/lib/instance/accounts'
import s from '../login/login.module.css'
import { SetupForm } from './SetupForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('appAuth')
  return { title: t('setup.metaTitle'), robots: { index: false, follow: false } }
}

/**
 * One-time setup of a self-hosted install. Reachable only while the install has no account at
 * all; once the first (owner) account exists this page redirects to sign-in for good. The hosted
 * edition has no such page.
 */
export default async function SetupPage() {
  if (!isSelfHosted()) notFound()
  if (await instanceHasUsers()) redirect('/login')
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
          <aside className={s.intro}>
            <span className="ed-tag">{t('setup.eyebrow')}</span>
            <p className={s.headline}>
              <span>{t('setup.headline')}</span>
            </p>
            <p className={s.introNote}>
              <span>{t('setup.note')}</span>
            </p>
          </aside>

          <section className={s.card} aria-labelledby="setup-title">
            <h1 id="setup-title" className={s.title}>{t('setup.title')}</h1>
            <p className={s.subtitle}>{t('setup.subtitle')}</p>
            <div className={s.form}>
              <SetupForm />
            </div>
          </section>
        </div>

        <footer className={`${s.row} ${s.footer}`}>
          <span>Supalens</span>
          <LanguageSwitcher variant="app" rootClassName={s.languageRoot} />
        </footer>
      </div>
    </main>
  )
}
