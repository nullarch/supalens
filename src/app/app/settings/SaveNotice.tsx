'use client'

import { useTranslations } from 'next-intl'
import type { SettingsNotice } from './use-settings-save'
import s from './settings.module.css'

/** A quiet one-line result: a state dot and the sentence. Errors keep a tinted line and the reload link. */
export function SaveNotice({ pending = false, notice }: { pending?: boolean; notice: SettingsNotice | null }) {
  const t = useTranslations('appSettings.save')
  if (pending) return <p className={s.saveNotice} data-kind="pending" role="status">{t('pending')}</p>
  if (!notice) return null
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- A full GET reloads saved settings after an uncertain result, bypassing the current route's client cache.
  return <p data-save-notice tabIndex={-1} className={s.saveNotice} data-kind={notice.kind} role={notice.kind === 'err' ? 'alert' : 'status'}>{notice.text}{notice.kind === 'err' && <> <a href="/app/settings">{t('reload')}</a></>}</p>
}
