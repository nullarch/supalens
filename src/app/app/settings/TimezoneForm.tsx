'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { Select } from '@/components/ui/Select'
import { updateOrgTimezone } from '@/lib/org/actions'
import { DEFAULT_TIMEZONE, formatInOrgTz, isValidTimezone, timezoneLabel, timezoneOptions } from '@/lib/org/timezone'
import s from './settings.module.css'
import { useSettingsSave } from './use-settings-save'
import { SaveNotice } from './SaveNotice'

const INTL_LOCALE: Record<string, string> = { ko: 'ko-KR', ja: 'ja-JP', en: 'en-US' }

/**
 * Workspace display timezone (owner/admin only; default UTC). Every operator timestamp in the
 * product is stored in UTC — this is the one declared zone the renderers read back.
 *
 * `pendingMigration` is a first-class state: the column ships in a migration that may not be
 * applied when this deploys, so a 42703 from the action is shown as an informational note and
 * the workspace keeps using UTC. It is never surfaced as a failure the user should retry.
 */
export function TimezoneForm({
  orgId,
  timezone,
  canEdit,
  pendingMigration = false,
  saveAction = updateOrgTimezone,
}: {
  orgId: string
  timezone: string
  canEdit: boolean
  /** The `organizations.timezone` column does not exist yet (migration unapplied). */
  pendingMigration?: boolean
  saveAction?: typeof updateOrgTimezone
}) {
  const t = useTranslations('appSettings')
  const locale = useLocale()
  const intlLocale = INTL_LOCALE[locale] ?? 'en-US'

  const [value, setValue] = useState(timezone || DEFAULT_TIMEZONE)
  const [saved, setSaved] = useState(timezone || DEFAULT_TIMEZONE)
  const [migration, setMigration] = useState(pendingMigration)
  useEffect(() => { setMigration(pendingMigration) }, [pendingMigration])
  const save = useSettingsSave()
  const { pending } = save
  const id = useId()
  const [browserTz, setBrowserTz] = useState<string | null>(null)
  // `null` until mounted. Both the browser zone and the instant used for the example are
  // client-only facts: reading either during render would make the SSR output differ from the
  // first client render (a hydration mismatch), so they stay empty on the server.
  const [now, setNow] = useState<string | null>(null)

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (isValidTimezone(tz)) setBrowserTz(tz)
    } catch {
      // no browser zone available — the hint simply doesn't render
    }
    setNow(new Date().toISOString())
  }, [])

  // 400+ options; building them once keeps re-renders cheap while the menu is open.
  const options = useMemo(() => {
    const zones = timezoneOptions()
    // A stored zone this runtime doesn't know (older data, or a zone dropped upstream) must
    // still be selectable, or saving anything else would silently discard it.
    const list = zones.includes(value) ? zones : [value, ...zones]
    return list.map((z) => ({ value: z, label: timezoneLabel(z) }))
  }, [value])

  const preview = formatInOrgTz(now, value, intlLocale, { dateStyle: 'medium', timeStyle: 'short' })
  const dirty = value !== saved

  function onSave() {
    if (!canEdit || !dirty || pending || migration || pendingMigration) return
    void save.run(() => saveAction(orgId, value), {
      success: t('timezone.saved'), failure: t('timezone.error'), migrationMessage: t('timezone.pendingMigration'),
      onConfirmed: () => setSaved(value),
      onFailed: kind => {
        if (kind === 'migration') { setMigration(true); setValue(saved) }
        // Other failures keep the selected draft available for correction or retry.
      },
    })
  }

  const status = <SaveNotice pending={pending} notice={save.notice} />

  return (
    <>
      <div className={s.cardBody}>
        <div className={`${s.field} ${s.fieldNarrow}`}>
          <label className={s.label} htmlFor={id}>
            {t('timezone.label')}
          </label>
          <Select
            id={id}
            ariaLabel={t('timezone.label')}
            value={value}
            onValueChange={next => { setValue(next); save.clearNotice() }}
            options={options}
            disabled={!canEdit || pending || migration || pendingMigration}
            className={s.selectTrigger}
            block
          />
          {preview && <span className={`${s.hint} ${s.tabular}`}>{t('timezone.preview', { time: preview })}</span>}
        </div>

        {canEdit && !migration && !pendingMigration && browserTz && browserTz !== value && (
          <p className={s.hint}>
            {t('timezone.browserHint', { tz: browserTz })}{' '}
            <button type="button" className={s.linkBtn} disabled={pending} onClick={() => { setValue(browserTz); save.clearNotice() }}>
              {t('timezone.useBrowser')}
            </button>
          </p>
        )}

        {!canEdit && <p className={s.note}>{t('timezone.readOnly')}</p>}

        {pendingMigration && !save.notice && (
          <p className={s.note} data-kind="warning">
            {t('timezone.pendingMigration')}
          </p>
        )}
      </div>

      {canEdit ? (
        <div className={s.foot}>
          {status}
          <button className={`dx-btn ${s.save}`} type="button" onClick={onSave} disabled={!dirty || pending || migration || pendingMigration} aria-busy={pending}>
            {pending ? t('timezone.saving') : t('timezone.save')}
          </button>
        </div>
      ) : (pending || save.notice) ? <div className={s.foot}>{status}</div> : null}
    </>
  )
}
