import { defineRouting } from 'next-intl/routing'

// Single source of truth for the locale set + routing strategy.
// - `en` is the default and is served UNPREFIXED (`/`), `/ko` + `/ja` are prefixed.
// - `localePrefix: 'as-needed'` is what keeps the English landing at the bare `/`.
export const routing = defineRouting({
  locales: ['en', 'ko', 'ja'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  // The choice always persists to a cookie so it carries from marketing (path)
  // into /app (cookie) — see src/i18n/request.ts + the middleware composition.
  localeCookie: {
    name: 'NEXT_LOCALE',
    // 1 year; not httpOnly so a client LanguageSwitcher can write it directly.
    maxAge: 60 * 60 * 24 * 365,
  },
})

export type Locale = (typeof routing.locales)[number]
