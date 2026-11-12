'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { openBillingPortal } from '@/lib/paddle/actions'
import { billingErrorLabel } from './error-label'

export interface BillingPortalIO {
  open: typeof openBillingPortal
  navigate: (url: string) => void
}
const defaultIO: BillingPortalIO = {
  open: openBillingPortal,
  navigate: url => { window.location.href = url },
}
export function useBillingPortal(actions: BillingPortalIO = defaultIO) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const t = useTranslations('appBilling')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function manage() {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await actions.open()
      if (!mounted.current) return
      if (!result.ok) setError(billingErrorLabel(t, result.error))
      else {
        const url = new URL(result.url)
        if (url.protocol !== 'https:') throw new Error('Invalid portal URL')
        actions.navigate(url.href)
        return // Stay busy while the browser leaves this page.
      }
    } catch {
      if (mounted.current) setError(t('errors.portal_failed'))
    }
    locked.current = false
    if (mounted.current) setBusy(false)
  }
  return { busy, error, manage }
}
