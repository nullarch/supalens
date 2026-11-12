import { routing, type Locale } from '@/i18n/routing'

function supported(value: unknown): value is Locale {
  return typeof value === 'string' && routing.locales.some(locale => locale === value)
}

/** Match the server's route-first, then display-cookie precedence. */
export function resolveDisplayLocale(segment: unknown, cookie: string | undefined, fallback: string): string {
  if (supported(segment)) return segment
  return supported(cookie) ? cookie : fallback
}

export function browserDisplayLocale(segment: unknown, fallback: string): string {
  const cookie = document.cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith('NEXT_LOCALE='))?.slice('NEXT_LOCALE='.length)
  return resolveDisplayLocale(segment, cookie, fallback)
}
