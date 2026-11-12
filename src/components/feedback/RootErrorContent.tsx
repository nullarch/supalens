'use client'

import { useEffect, useState } from 'react'
import { FALLBACK_COPY, fallbackHome, fallbackLocale, type FallbackLocale } from './fallback-copy'
import { FallbackSurface } from './FallbackSurface'

/** Does not use the providers or router that may have caused the root failure.
 * English is the deterministic SSR fallback; path/cookie choice is restored on
 * mount without reading a profile or writing a display preference. */
export function useRootErrorDisplay() {
  const [locale, setLocale] = useState<FallbackLocale>('en')
  const [theme, setTheme] = useState<'light' | 'dark'>()
  useEffect(() => {
    let cookie = ''
    try { cookie = document.cookie } catch { /* storage can be blocked */ }
    const selected = fallbackLocale(window.location.pathname, cookie)
    setLocale(selected)
    document.documentElement.lang = selected
    try {
      const stored = localStorage.getItem('theme')
      if (stored === 'light' || stored === 'dark') setTheme(stored)
    } catch { /* native CSS follows the system theme */ }
  }, [])
  return { locale, theme }
}

export function RootErrorContent({ locale, reset }: { locale: FallbackLocale; reset: () => void }) {
  const copy = FALLBACK_COPY[locale]
  const href = fallbackHome(locale)
  return <FallbackSurface title={copy.title} description={copy.body} home={{ href, label: copy.home }}>
    <button type="button" className="sl-fallback-action sl-fallback-primary" onClick={reset}>{copy.retry}</button>
    <a href={href} className="sl-fallback-action">{copy.home}</a>
  </FallbackSurface>
}
