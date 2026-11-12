'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { updateEmailPrefs } from '@/lib/org/actions'
import { useSettingsSave } from './use-settings-save'
import { SaveNotice } from './SaveNotice'
import s from './settings.module.css'

/** Personal opt-outs; workspace digest enablement remains a separate owner/admin setting. */
export function EmailPrefsForm({ orgId, digestOptOut, alertOptOut, lifecycleOptOut, saveAction = updateEmailPrefs }: {
  orgId: string; digestOptOut: boolean; alertOptOut: boolean; lifecycleOptOut: boolean
  saveAction?: typeof updateEmailPrefs
}) {
  const t = useTranslations('appSettings')
  const id = useId()
  const [prefs, setPrefs] = useState({ digest: !digestOptOut, alert: !alertOptOut, lifecycle: !lifecycleOptOut })
  const save = useSettingsSave()

  function toggle(key: keyof typeof prefs) {
    const before = prefs
    const next = !prefs[key]
    void save.run(() => saveAction(orgId, { [key + 'OptOut']: !next }), {
      success: t('emailPrefs.saved'), failure: t('emailPrefs.error'),
      onStart: () => setPrefs({ ...before, [key]: next }),
      onFailed: () => setPrefs(before),
    })
  }

  return <>
    <div className={s.preferenceRows}>
      {(['digest', 'alert', 'lifecycle'] as const).map(key => <label key={key} htmlFor={id + '-' + key} className={s.preferenceRow}>
        <span className={s.preferenceText}>
          <span id={id + '-' + key + '-label'} className={s.preferenceLabel}>{t('emailPrefs.' + key)}</span>
          <span id={id + '-' + key + '-hint'} className={s.hint}>{t('emailPrefs.' + key + 'Desc')}</span>
        </span>
        <input id={id + '-' + key} className={s.switch} type="checkbox" checked={prefs[key]} disabled={save.pending}
          onChange={() => toggle(key)} aria-labelledby={id + '-' + key + '-label'} aria-describedby={id + '-' + key + '-hint'} />
      </label>)}
    </div>
    {(save.pending || save.notice) && <div className={s.foot}><SaveNotice pending={save.pending} notice={save.notice} /></div>}
  </>
}
