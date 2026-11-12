'use client'

import { useLocale } from 'next-intl'
import { useParams, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { browserDisplayLocale } from './display-locale'

/** Shared root effects must follow route/cookie changes without remounting
 * the authentication provider or rebooting support on every same-locale page.
 */
export function useDisplayLocale() {
  const fallback = useLocale()
  const { locale: segment } = useParams()
  const pathname = usePathname()
  const [locale, setLocale] = useState(fallback)

  useEffect(() => {
    setLocale(browserDisplayLocale(segment, fallback))
  }, [segment, fallback, pathname])

  return locale
}
