'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { createMemberAccount, resetMemberPassword, type AssignableRole } from '@/lib/org/actions'
import type { MemberRow } from '@/lib/org/server'
import { Select } from '@/components/ui/Select'
import s from './team.module.css'

const MIN_PASSWORD = 8
type Notice = { kind: 'ok' | 'err'; text: string }

/**
 * Self-hosted member management: the admin creates each account (email + initial password) and
 * can set a new password for someone who lost theirs. It replaces the invitation form, which
 * needs an email provider and public sign-up — a self-hosted install has neither.
 */
export function InternalAccounts({
  orgId,
  roles,
  resettable,
  roleLabel,
}: {
  orgId: string
  /** Roles the caller may assign (strictly below their own). */
  roles: AssignableRole[]
  /** Members the caller may reset (strictly below them, never themselves). */
  resettable: MemberRow[]
  roleLabel: (role: string) => string
}) {
  const t = useTranslations('appMembers')
  const id = useId()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AssignableRole>(roles.includes('member') ? 'member' : roles[0])
  const [target, setTarget] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  async function run(action: () => Promise<{ ok: boolean; message?: string }>, done: string, after: () => void) {
    if (busy) return
    setBusy(true); setNotice(null)
    try {
      const result = await action()
      if (result.ok) { setNotice({ kind: 'ok', text: done }); after(); router.refresh() }
      else setNotice({ kind: 'err', text: result.message ?? t('accounts.failed') })
    } catch {
      setNotice({ kind: 'err', text: t('accounts.failed') })
    }
    setBusy(false)
  }

  const onCreate = (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < MIN_PASSWORD) { setNotice({ kind: 'err', text: t('accounts.weak', { min: MIN_PASSWORD }) }); return }
    void run(() => createMemberAccount(orgId, email, password, role), t('accounts.created', { email: email.trim() }), () => { setEmail(''); setPassword('') })
  }
  const onReset = (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    if (newPassword.length < MIN_PASSWORD) { setNotice({ kind: 'err', text: t('accounts.weak', { min: MIN_PASSWORD }) }); return }
    void run(() => resetMemberPassword(orgId, target, newPassword), t('accounts.resetDone'), () => { setNewPassword(''); setTarget('') })
  }

  return (
    <>
      {notice && (
        <div className={s.notice} data-kind={notice.kind === 'err' ? 'err' : undefined} role={notice.kind === 'err' ? 'alert' : 'status'}>
          <span className={s.noticeText}>{notice.text}</span>
        </div>
      )}

      <section className={s.invite} aria-labelledby={`${id}-create`} data-internal-accounts>
        <div className={s.inviteHead}>
          <h2 id={`${id}-create`} className={s.cardTitle}>{t('accounts.createTitle')}</h2>
          <p className={s.inviteHint}>{t('accounts.createHint')}</p>
        </div>
        <form onSubmit={onCreate} className={s.inviteForm}>
          <label className={s.fieldLabel} htmlFor={`${id}-email`}>{t('accounts.email')}</label>
          <div className={s.inviteControls}>
            <input id={`${id}-email`} className={s.input} type="email" required autoComplete="off" disabled={busy}
              placeholder={t('accounts.email')} value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={s.input} type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" disabled={busy}
              placeholder={t('accounts.initialPassword')} aria-label={t('accounts.initialPassword')}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            <Select disabled={busy} value={role} onValueChange={(v) => setRole(v as AssignableRole)} ariaLabel={t('table.colRole')}
              rootClassName={s.roleSelect} className={s.selectTrigger}
              options={roles.map((r) => ({ value: r, label: roleLabel(r) }))} />
            <button className={`dx-btn ${s.submit}`} type="submit" disabled={busy}>{t('accounts.create')}</button>
          </div>
        </form>
      </section>

      {resettable.length > 0 && (
        <section className={s.invite} aria-labelledby={`${id}-reset`}>
          <div className={s.inviteHead}>
            <h2 id={`${id}-reset`} className={s.cardTitle}>{t('accounts.resetTitle')}</h2>
            <p className={s.inviteHint}>{t('accounts.resetHint')}</p>
          </div>
          <form onSubmit={onReset} className={s.inviteForm}>
            <div className={s.inviteControls}>
              <Select disabled={busy} value={target} onValueChange={setTarget} ariaLabel={t('table.colMember')}
                placeholder={t('accounts.pickMember')} rootClassName={s.roleSelect} className={s.selectTrigger}
                options={resettable.map((m) => ({ value: m.userId, label: m.email ?? m.displayName ?? m.userId }))} />
              <input className={s.input} type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" disabled={busy}
                placeholder={t('accounts.newPassword')} aria-label={t('accounts.newPassword')}
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button className={`dx-btn ${s.submit}`} type="submit" disabled={busy || !target}>{t('accounts.reset')}</button>
            </div>
          </form>
        </section>
      )}
    </>
  )
}
