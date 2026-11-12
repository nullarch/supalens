'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { renameOrg } from '@/lib/org/actions'
import { isCloud } from '@/config/edition'
import s from './settings.module.css'
import { useSettingsSave } from './use-settings-save'
import { SaveNotice } from './SaveNotice'

/**
 * Organization name editor. `canEdit` (owner/admin) gates the input + save; the
 * server action re-checks via the org_write RLS policy regardless.
 */
export function OrgInfoForm({
  orgId,
  name,
  slug,
  canEdit,
  saveAction = renameOrg,
  refresh,
}: {
  orgId: string
  name: string
  slug: string
  canEdit: boolean
  saveAction?: typeof renameOrg
  refresh?: () => void
}) {
  const t = useTranslations('appSettings')
  const router = useRouter()
  const [value, setValue] = useState(name)
  const [saved, setSaved] = useState(name)
  const save = useSettingsSave()
  const { pending } = save
  const id = useId()

  const dirty = value.trim() !== saved && value.trim().length > 0

  function onSave() {
    if (!canEdit || !dirty || pending) return
    void save.run(() => saveAction(orgId, value), {
      success: t('orgInfo.renamed'), failure: t('orgInfo.renameFailed'),
      onConfirmed: () => {
        setSaved(value.trim())
        setValue(value.trim())
        try { (refresh ?? router.refresh)() } catch { /* confirmed save remains confirmed */ }
      },
    })
  }

  const status = <SaveNotice pending={pending} notice={save.notice} />

  return (
    <>
      <div className={s.cardBody}>
        <div className={s.fieldGrid}>
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-name`}>
              {t('orgInfo.nameLabel')}
            </label>
            <input
              id={`${id}-name`}
              className={s.input}
              type="text"
              value={value}
              onChange={(e) => { setValue(e.target.value); save.clearNotice() }}
              readOnly={!canEdit}
              disabled={pending}
            />
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-slug`}>
              {t('orgInfo.slugLabel')}
            </label>
            <input id={`${id}-slug`} className={`${s.input} ${s.mono}`} type="text" value={slug} readOnly />
            {isCloud() && <span className={`${s.hint} ${s.monoHint}`}>supalens.ai/{slug}</span>}
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className={s.foot}>
          {status}
          <button className={`dx-btn ${s.save}`} type="button" onClick={onSave} disabled={!dirty || pending} aria-busy={pending}>
            {pending ? t('orgInfo.saving') : t('orgInfo.save')}
          </button>
        </div>
      ) : (pending || save.notice) ? <div className={s.foot}>{status}</div> : null}
    </>
  )
}
