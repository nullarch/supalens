'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { settingsItems, isCurrent } from './nav'
import s from './settings-nav.module.css'

/**
 * The sections inside Settings. The sidebar carries ONE Settings row, so this is where its pages
 * are navigated — the same list, one level in, where it costs attention only while someone is
 * actually configuring something.
 */
export function SettingsNav() {
  const pathname = usePathname()
  const t = useTranslations('appChrome')
  return (
    <nav className={s.wrap} aria-label={t('nav.settingsSections')}>
      <div className={`dx-segmented ${s.tabs}`}>
        {settingsItems().map((item) => {
          const current = isCurrent(pathname, item)
          return (
            <Link key={item.href} href={item.href} aria-current={current ? 'page' : undefined}>
              {t(item.labelKey)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
