import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { CircleAlert, ShieldCheck } from 'lucide-react'

import { createClient } from '@/utils/supabase/server'
import { LoginForm } from '@/components/auth/LoginForm'
import LogoMark from '@/components/brand/LogoMark'
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher'
import { COMPANY } from '@/components/landing/Footer'
import { isCloud } from '@/config/edition'
import '@/components/landing/editorial/editorial.css'
import { editorialFontVariables } from '@/components/landing/editorial/fonts'
import s from './login.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('appAuth')
  return {
    title: t(isCloud() ? 'login.metaTitle' : 'login.selfMetaTitle'),
    description: isCloud() ? t('login.metaDescription') : undefined,
    robots: { index: false, follow: false },
  }
}

function safeNext(n?: string): string {
  if (!n || !n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\')) {
    return '/app/ask'
  }
  // Reject control chars + backslash: the WHATWG URL parser strips tab/LF/CR
  // and would collapse `/%09/evil.com` into a protocol-relative `//evil.com`.
  if (/[\u0000-\u001f\u007f\\]/.test(n)) return '/app/ask'
  return n
}

// A Map (not a plain object) so an attacker-supplied ?error= naming a prototype
// member (constructor, __proto__, …) can't return a function/object and crash SSR.
// Values are appAuth.login.* message keys, resolved with the request locale in the component.
const ERROR_KEYS = new Map<string, string>([
  ['not_configured', 'errorNotConfigured'],
  ['auth_failed', 'errorAuthFailed'],
  ['missing_code', 'errorMissingCode'],
])

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const sp = await searchParams
  const next = safeNext(sp.next)
  const t = await getTranslations('appAuth')
  const tNav = await getTranslations('nav')
  const locale = await getLocale()
  const publicPrefix = locale === 'en' ? '' : `/${locale}`
  const home = publicPrefix || '/'
  const cloud = isCloud()

  const supabase = await createClient()
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) redirect(next)
  }

  // A fresh self-hosted install has no accounts: the first visitor sets it up. Dynamic import
  // keeps the service-role module out of the hosted login page.
  if (!cloud) {
    const { instanceHasUsers } = await import('@/lib/instance/accounts')
    if (!(await instanceHasUsers())) redirect('/setup')
  }

  const errorText = sp.error ? t(`login.${ERROR_KEYS.get(sp.error) ?? 'errorGeneric'}`) : null
  const plain = (c: React.ReactNode) => <>{c}</>

  return (
    // Simple structure (bar, intro beside one card, one-line footer) drawn in the
    // editorial system the home page and /app share: serif wordmark and titles, DM Sans,
    // lavender panel, ink action. Bar, body and footer share one 1080px column so every edge
    // lines up. Language is cookie-driven here, like /app.
    <main className={`ed ${editorialFontVariables}`}>
      <div className={s.page}>
        <header className={`${s.row} ${s.header}`}>
          <Link href={home} className={s.brand} aria-label={t('login.homeAria')}>
            <LogoMark size={20} />
            <span className={s.wordmark}>Supalens</span>
          </Link>
          {/* The marketing site, the public demo and the hosted service's legal pages exist
              only on the cloud edition. */}
          {cloud && (
            <nav className={s.nav}>
              <Link href={`${publicPrefix}/demo`} className={s.navLink}>
                {tNav('liveDemo')}
              </Link>
              <Link href={home} className="ed-button ed-button--small">
                {t('login.backHome')}
              </Link>
            </nav>
          )}
        </header>

        <div className={`${s.row} ${s.shell}`}>
          {/* Short intro; the page's real <h1> is the card heading. */}
          <aside className={s.intro}>
            <span className="ed-tag">{t('login.eyebrow')}</span>
            <p className={s.headline}>
              <span>{t.rich('login.headline1', { em: plain })}</span>
              <span>{t('login.headline2')}</span>
            </p>
            <p className={s.introNote}>
              <ShieldCheck size={16} aria-hidden />
              <span>{t.rich('login.point4', { b: plain })}</span>
            </p>
          </aside>

          <section className={s.card} aria-labelledby="login-title">
            <h1 id="login-title" className={s.title}>
              {t(cloud ? 'login.title' : 'login.selfTitle')}
            </h1>
            <p className={s.subtitle}>{t(cloud ? 'login.subtitle' : 'login.selfSubtitle')}</p>

            {errorText && (
              <div className={s.status} role="alert">
                <CircleAlert size={16} aria-hidden />
                <span>{errorText}</span>
              </div>
            )}

            <div className={s.form}>
              <LoginForm next={next} />
            </div>

            {cloud && (
              <p className={s.legal}>
                {t.rich('login.legal', {
                  terms: (c) => <Link href={`${publicPrefix}/terms`}>{c}</Link>,
                  privacy: (c) => <Link href={`${publicPrefix}/privacy`}>{c}</Link>,
                })}
              </p>
            )}
          </section>
        </div>

        <footer className={`${s.row} ${s.footer}`}>
          <span>{cloud ? `© ${COMPANY.name}` : 'Supalens'}</span>
          <LanguageSwitcher variant="app" rootClassName={s.languageRoot} />
        </footer>
      </div>
    </main>
  )
}
