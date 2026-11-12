import type { MetadataRoute } from 'next'

import { routing } from '@/i18n/routing'
import { publicOrigin } from '@/lib/metadata/public-origin'

// Public marketing routes (the localized surface). /app + auth + api are excluded (noindex).
const MARKETING_PATHS = ['', '/supabase', '/demo', '/x', '/docs/mcp', '/privacy', '/terms', '/refund'] as const

// Build the localized URL for a path: default locale (en) is unprefixed, ko/ja are prefixed.
function localizedUrl(path: string, locale: string): string {
  const SITE_URL = publicOrigin()
  if (locale === routing.defaultLocale) return `${SITE_URL}${path}`
  return `${SITE_URL}/${locale}${path}`
}

export default function sitemap(): MetadataRoute.Sitemap {
  return MARKETING_PATHS.map((path) => ({
    url: localizedUrl(path, routing.defaultLocale),
    changeFrequency: 'weekly' as const,
    priority: path === '' ? 1 : path === '/supabase' || path === '/demo' || path === '/x' ? 0.8 : 0.5,
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((locale) => [locale, localizedUrl(path, locale)]),
      ),
    },
  }))
}
