'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui/Select'
import { routing } from '@/i18n/routing'
import { setUserLocale } from '@/lib/i18n/actions'
import { SaveNotice } from './SaveNotice'
import { captureSettingsFocus, restoreSettingsFocus } from './settings-focus'
import s from './settings.module.css'

export interface LanguagePreferenceIO {
  persist: typeof setUserLocale
  applyLocale: (locale: string) => void
}

const LABELS: Record<string, string> = { en: 'English', ko: '한국어', ja: '日本語' }

export function applySettingsDisplayLocale(locale: string, refresh: () => void) {
  document.cookie = 'NEXT_LOCALE=' + locale + ';path=/;max-age=31536000;samesite=lax'
  refresh()
}

/** The display cookie and durable email/profile preference are distinct outcomes. */
export function LanguagePref({ io }: { io?: LanguagePreferenceIO }) {
  const t = useTranslations('appSettings')
  const locale = useLocale()
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState(locale)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'profileFailed' | 'displayFailed'>('idle')
  const locked = useRef(false)
  const mounted = useRef(true)
  const epoch = useRef(0)
  const selection = useRef(locale)
  const origin = useRef<ReturnType<typeof captureSettingsFocus> | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (status !== 'saving') { restoreSettingsFocus(origin.current); origin.current = null }
  }, [status])
  useEffect(() => {
    // An independent locale change supersedes feedback for an earlier selection.
    if (locale !== selection.current) {
      epoch.current++
      selection.current = locale
      setValue(locale)
      setStatus('idle')
      locked.current = false
    }
  }, [locale])

  async function choose(next: string, display: boolean) {
    if (locked.current || !routing.locales.includes(next as typeof routing.locales[number])) return
    locked.current = true
    origin.current = captureSettingsFocus()
    const request = ++epoch.current
    selection.current = next
    setValue(next)
    setStatus('saving')
    if (display) {
      try {
        if (io) io.applyLocale(next)
        else applySettingsDisplayLocale(next, () => router.refresh())
      } catch {
        if (mounted.current && request === epoch.current) { setStatus('displayFailed'); locked.current = false }
        return
      }
    }
    let saved = false
    try { saved = (await (io?.persist ?? setUserLocale)(next))?.ok === true } catch { /* keep display choice; durable save is unconfirmed */ }
    if (mounted.current && request === epoch.current) {
      setStatus(saved ? 'saved' : 'profileFailed')
      locked.current = false
    }
  }

  const pending = status === 'saving'
  return <>
    <div className={s.cardBody}>
      <div className={`${s.field} ${s.fieldNarrow}`}>
        <label htmlFor={id} className={s.label}>{t('language.label')}</label>
        <Select id={id} ariaLabel={t('language.label')} value={value} disabled={pending} block className={s.selectTrigger}
          options={routing.locales.map(loc => ({ value: loc, label: LABELS[loc] }))}
          onValueChange={next => { if (next !== value) void choose(next, true) }} />
      </div>
    </div>
    {status !== 'idle' && <div className={s.foot}>
      <SaveNotice pending={pending} notice={status === 'saving' ? null
        : { kind: status === 'saved' ? 'ok' : 'err', text: t('language.' + status) }} />
      {status === 'profileFailed' && <button type="button" className={`dx-btn-ghost ${s.save}`} onClick={() => void choose(value, false)}>{t('language.retry')}</button>}
    </div>}
  </>
}
