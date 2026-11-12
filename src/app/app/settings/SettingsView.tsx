import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { PageHead } from '@/components/dashboard/PageHead'
import type { renameOrg, updateOrgTimezone, updateEmailPrefs, setWeeklyDigestEnabled } from '@/lib/org/actions'
import { OrgInfoForm } from './OrgInfoForm'
import { TimezoneForm } from './TimezoneForm'
import { WeeklyDigestToggle } from './WeeklyDigestToggle'
import { EmailPrefsForm } from './EmailPrefsForm'
import { LanguagePref, type LanguagePreferenceIO } from './LanguagePref'
import { DangerZone } from './DangerZone'
import { PasswordForm } from './PasswordForm'
import { isSelfHosted } from '@/config/edition'
import s from './settings.module.css'

export interface SettingsIO {
  rename: typeof renameOrg
  timezone: typeof updateOrgTimezone
  email: typeof updateEmailPrefs
  weekly: typeof setWeeklyDigestEnabled
  language: LanguagePreferenceIO
  refresh: () => void
}

export interface SettingsViewProps {
  orgId: string; name: string; slug: string; timezone: string; pendingMigration: boolean
  canEditOrg: boolean; isOwner: boolean; weeklyDigestEnabled: boolean
  digestOptOut: boolean; alertOptOut: boolean; lifecycleOptOut: boolean
  io?: SettingsIO; danger?: ReactNode; showHeading?: boolean
}

/**
 * Settings as a stack of cards: each setting is a white card with its name, what it governs and
 * its controls (a tinted foot carries the save action and result), grouped under a workspace label
 * and a personal label, with the irreversible actions in a negative-bordered card at the end.
 * Authentication, queries and role derivation stay in page.tsx.
 */
export function SettingsView({ orgId, name, slug, timezone, pendingMigration, canEditOrg, isOwner,
  weeklyDigestEnabled, digestOptOut, alertOptOut, lifecycleOptOut, io, danger, showHeading = true }: SettingsViewProps) {
  const t = useTranslations('appSettings')
  const chrome = useTranslations('appChrome')
  const head = (key: string, title: string, desc?: string) => <div className={s.cardHead}>
    <h2 id={`${orgId}-settings-${key}`} className={s.cardTitle}>{title}</h2>
    {desc && <p className={s.cardDesc}>{desc}</p>}
  </div>
  const card = (key: string, title: string, desc: string, children: ReactNode) => <section key={key}
    data-setting={key} className={s.card} aria-labelledby={`${orgId}-settings-${key}`}>
    {head(key, title, desc)}
    {children}
  </section>
  return <div key={orgId} className={s.wrap}>
    {showHeading && <PageHead title={chrome('nav.settingsGeneral')} subtitle={t('subtitle')} />}
    <div className={s.doc}>
      <div className={s.group}>
        <p className={s.groupLabel}>{t('groups.workspace')}</p>
        {card('org', t('orgInfo.cardTitle'), t('orgInfo.desc'), <OrgInfoForm orgId={orgId} name={name} slug={slug} canEdit={canEditOrg} saveAction={io?.rename} refresh={io?.refresh} />)}
        {card('timezone', t('timezone.title'), t('timezone.desc'), <TimezoneForm orgId={orgId} timezone={timezone} canEdit={canEditOrg} pendingMigration={pendingMigration} saveAction={io?.timezone} />)}
        {canEditOrg && card('weekly', t('weeklyDigest.title'), t('weeklyDigest.desc'), <WeeklyDigestToggle orgId={orgId} enabled={weeklyDigestEnabled} saveAction={io?.weekly} />)}
      </div>
      <div className={s.group}>
        <p className={s.groupLabel}>{t('groups.personal')}</p>
        {card('language', t('language.title'), t('language.desc'), <LanguagePref io={io?.language} />)}
        {isSelfHosted() && card('password', t('password.title'), t('password.desc'), <PasswordForm />)}
        {card('email', t('emailPrefs.title'), t('emailPrefs.desc'), <EmailPrefsForm orgId={orgId} digestOptOut={digestOptOut} alertOptOut={alertOptOut} lifecycleOptOut={lifecycleOptOut} saveAction={io?.email} />)}
      </div>
      <section data-setting="danger" className={`${s.card} ${s.danger}`} aria-labelledby={`${orgId}-settings-danger`}>
        {head('danger', t('danger.cardTitle'), t('danger.desc'))}
        {danger ?? <DangerZone orgId={orgId} orgName={name} isOwner={isOwner} />}
      </section>
    </div>
  </div>
}
