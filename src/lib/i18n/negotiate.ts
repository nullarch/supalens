// Pure locale-negotiation helpers (no request/DB/runtime deps) shared by the
// middleware locale-seeding pass. Kept separate from `app-locale-cookie.ts` so the
// parsing is unit-testable in isolation.

import { routing, type Locale } from '@/i18n/routing'

const LOCALE_SET = new Set<string>(routing.locales)

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && LOCALE_SET.has(value)
}

/**
 * Minimal RFC-7231 Accept-Language negotiation against the app's supported locales.
 * Matches by PRIMARY subtag (`ko-KR` → `ko`), honours q-weights (higher first), and
 * returns null when nothing matches (caller falls back to the default locale).
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const weight = qParam ? Number.parseFloat(qParam.slice(2)) : 1
      return {
        base: tag.trim().toLowerCase().split('-')[0],
        q: Number.isFinite(weight) ? weight : 0,
      }
    })
    .filter((entry) => entry.base && entry.q > 0)
    .sort((a, b) => b.q - a.q)

  for (const { base } of ranked) {
    if (LOCALE_SET.has(base)) return base as Locale
  }
  return null
}
