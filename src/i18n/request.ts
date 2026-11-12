import { cookies } from 'next/headers'
import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'

import { routing } from './routing'

// Unified locale resolver — the seam that lets marketing (path-routed) and /app
// (cookie-driven) share ONE config:
//   1. If a `[locale]` route segment is present (marketing), use it.
//   2. Otherwise (every /app + login + other non-`[locale]` route) fall back to
//      the NEXT_LOCALE cookie, then the default locale.
// P2 turns /app cookie-driven for free: no route move, same resolver.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale

  let locale: string = routing.defaultLocale
  if (hasLocale(routing.locales, requested)) {
    locale = requested
  } else {
    const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value
    if (hasLocale(routing.locales, cookieLocale)) {
      locale = cookieLocale
    }
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
