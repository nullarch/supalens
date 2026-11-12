'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRouter as useNextRouter } from 'next/navigation'
import { useTransition } from 'react'

import { getPathname, usePathname } from '@/i18n/navigation'
import { routing, type Locale } from '@/i18n/routing'
import { Select } from '@/components/ui/Select'

const LABELS: Record<string, string> = {
  en: 'EN',
  ko: '한국어',
  ja: '日本語',
}

const COOKIE = 'NEXT_LOCALE'
const ONE_YEAR = 60 * 60 * 24 * 365

/**
 * Language switcher with two variants:
 *  - `marketing` (default): navigates to next-intl's canonical locale pathname
 *    and writes NEXT_LOCALE, carrying the choice into /app.
 *  - `app`: /app is NOT path-routed (no `[locale]` segment), so we DON'T navigate — we just
 *    write NEXT_LOCALE and `router.refresh()` so the server re-renders in the new locale.
 *    (P3 also persists the choice to the user profile for cron/email locale.)
 */
export default function LanguageSwitcher({
  className,
  rootClassName,
  variant = 'marketing',
  onPersist,
}: {
  className?: string
  /** Sizes the Select root (its default 130px minimum suits form fields, not compact bars). */
  rootClassName?: string
  variant?: 'marketing' | 'app'
  onPersist?: (locale: string) => void
}) {
  const locale = useLocale()
  const t = useTranslations('common')
  const pathname = usePathname()
  const nextRouter = useNextRouter()
  const [isPending, startTransition] = useTransition()

  function onChange(next: string) {
    if (next === locale || !routing.locales.some(value => value === next)) return
    startTransition(() => {
      document.cookie = `${COOKIE}=${next};path=/;max-age=${ONE_YEAR};samesite=lax`
      if (variant === 'app') {
        onPersist?.(next)
        nextRouter.refresh()
      } else {
        // The locale router deliberately forces /en before redirecting to /.
        // That redirect drops the fragment in client navigation. Persist the
        // cookie first and use the canonical as-needed URL directly instead.
        nextRouter.replace(getPathname({
          locale: next as Locale,
          href: pathname + window.location.search + window.location.hash,
        }))
      }
    })
  }

  return (
    <Select
      // marketing header keeps its transparent-pill look via `className` (bare variant);
      // the /app settings switcher uses the standard bordered field.
      variant={variant === 'app' ? 'field' : 'bare'}
      size="sm"
      className={className}
      rootClassName={rootClassName}
      value={locale}
      disabled={isPending}
      ariaLabel={t('language')}
      onValueChange={onChange}
      options={routing.locales.map((l) => ({ value: l, label: LABELS[l] ?? l }))}
    />
  )
}
