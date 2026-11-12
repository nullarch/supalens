'use client'

import { useEffect } from 'react'
import { useDisplayLocale } from './use-display-locale'

/** The shared <html> layout does not rerender on locale-segment navigation.
 * Its server-rendered lang remains the initial-request fallback; keep the DOM
 * attribute aligned with the current route for screen readers and formatters.
 */
export default function DocumentLocale() {
  const locale = useDisplayLocale()

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return null
}
