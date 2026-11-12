'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { RootErrorContent, useRootErrorDisplay } from '@/components/feedback/RootErrorContent'
import { FALLBACK_COPY } from '@/components/feedback/fallback-copy'

/**
 * Root error boundary — catches crashes in the root layout itself (rare, but
 * without this file a crash there white-screens with zero visibility). Regular
 * route crashes are caught by nested error.tsx files (add one per route segment
 * that needs a friendlier fallback than this).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale, theme } = useRootErrorDisplay()
  useEffect(() => {
    try { Sentry.captureException(error) } catch { /* reporting must not break the last-resort UI */ }
  }, [error])

  return (
    <html lang={locale}>
      <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>{FALLBACK_COPY[locale].title} · Supalens</title></head>
      <body className="sl-root-fallback" data-fallback-theme={theme}>
        <main><RootErrorContent locale={locale} reset={reset} /></main>
      </body>
    </html>
  )
}
