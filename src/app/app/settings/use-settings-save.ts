'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { settingsSaveResult, type SettingsSaveResult } from './save-result'
import { captureSettingsFocus, restoreSettingsFocus } from './settings-focus'

export type SettingsNotice = { kind: 'ok' | 'err' | 'info'; text: string }

/** Shared client feedback only. Each caller keeps its existing authorized server action. */
export function useSettingsSave() {
  const t = useTranslations('appSettings.save')
  const locked = useRef(false)
  const mounted = useRef(true)
  const origin = useRef<ReturnType<typeof captureSettingsFocus> | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<SettingsNotice | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!pending) { restoreSettingsFocus(origin.current); origin.current = null }
  }, [pending])

  async function run(action: () => Promise<unknown>, options: {
    success: string; failure: string; migrationMessage?: string
    onStart?: () => void; onConfirmed?: () => void; onFailed?: (kind: SettingsSaveResult) => void
  }) {
    if (locked.current) return
    locked.current = true
    origin.current = captureSettingsFocus()
    setPending(true)
    setNotice(null)
    options.onStart?.()
    let response: unknown
    try { response = await action() } catch { response = undefined }
    if (!mounted.current) { locked.current = false; return }
    const outcome = settingsSaveResult(response, options.migrationMessage)
    setNotice(outcome.kind === 'confirmed' ? { kind: 'ok', text: options.success }
      : outcome.kind === 'migration' ? { kind: 'info', text: outcome.message! }
        : { kind: 'err', text: outcome.kind === 'unconfirmed' ? t('unconfirmed') : outcome.message ?? options.failure })
    try {
      if (outcome.kind === 'confirmed') options.onConfirmed?.()
      else options.onFailed?.(outcome.kind)
    } catch {
      // Local presentation/refresh failure does not alter the recorded action response.
    } finally {
      // A refresh callback cannot turn an acknowledged save into a failed save.
      locked.current = false
      setPending(false)
    }
  }
  return { pending, notice, clearNotice: () => setNotice(null), run }
}
