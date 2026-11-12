'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'

import { setWeeklyDigestEnabled } from '@/lib/org/actions'
import s from './settings.module.css'
import { useSettingsSave } from './use-settings-save'
import { SaveNotice } from './SaveNotice'

/**
 * Workspace-level opt-in for the weekly AI digest (owner/admin only; default off). Distinct
 * from the per-member EmailPrefsForm opt-out: this switch decides whether the workspace sends
 * a digest at all. Rendered only for owner/admin (page gates on canEdit).
 */
export function WeeklyDigestToggle({ orgId, enabled, saveAction = setWeeklyDigestEnabled }: { orgId: string; enabled: boolean; saveAction?: typeof setWeeklyDigestEnabled }) {
  const t = useTranslations('appSettings')
  const [on, setOn] = useState(enabled)
  const save = useSettingsSave()
  const { pending } = save
  const id = useId()

  function toggle() {
    const next = !on
    void save.run(() => saveAction(orgId, next), {
      success: t('weeklyDigest.saved'), failure: t('weeklyDigest.error'),
      onStart: () => setOn(next), onFailed: () => setOn(on),
    })
  }

  return (
    <>
      <div className={s.preferenceRows}>
        <label htmlFor={id} className={s.preferenceRow}>
          <span className={s.preferenceText}>
            <span id={`${id}-label`} className={s.preferenceLabel}>{t('weeklyDigest.toggle')}</span>
            <span id={`${id}-hint`} className={s.hint}>{t('weeklyDigest.toggleDesc')}</span>
          </span>
          <input
            id={id}
            className={s.switch}
            type="checkbox"
            checked={on}
            onChange={toggle}
            disabled={pending}
            aria-describedby={`${id}-hint`}
            aria-labelledby={`${id}-label`}
          />
        </label>
      </div>
      {(pending || save.notice) && <div className={s.foot}><SaveNotice pending={pending} notice={save.notice} /></div>}
    </>
  )
}
