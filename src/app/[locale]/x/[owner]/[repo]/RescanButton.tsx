'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { useRouter } from '@/i18n/navigation'
import s from './report.module.css'

/**
 * Starts a fresh scan of this repo (`rescan: true` skips the "already X-rayed" offer) and reloads
 * the page, which then renders the live scan. Errors (rate limits, budget) show inline with the
 * same copy as the /x form.
 */
export default function RescanButton({ repo, label, variant = 'button' }: { repo: string; label: string; variant?: 'button' | 'link' }) {
  const t = useTranslations('xray.form')
  const locale = useLocale()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function rescan() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/xray', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, locale, rescan: true }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.ok) {
        router.refresh()
        return
      }
      const code = typeof data.error === 'string' ? data.error : 'unavailable'
      setError(t.has(`errors.${code}`) ? t(`errors.${code}`, { repo }) : t('errors.unavailable'))
    } catch {
      setError(t('errors.network'))
    }
    setPending(false)
  }

  return (
    <span className={s.rescanWrap}>
      <button type="button" className={variant === 'link' ? s.rescanLink : s.rescanButton} disabled={pending} onClick={() => void rescan()}>
        {pending ? t('submitting') : label}
      </button>
      {error && (
        <span className={s.rescanError} role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
