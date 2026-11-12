'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'

import { createClient } from '@/utils/supabase/client'
import s from './settings.module.css'

const MIN_PASSWORD = 8

/**
 * Change your own password. Shown on a self-hosted install, where accounts are email + password
 * and there is no emailed reset link — the admin sets the first password and each person changes
 * it here.
 */
export function PasswordForm() {
  const t = useTranslations('appSettings')
  const id = useId()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function save() {
    if (pending) return
    if (password.length < MIN_PASSWORD) { setNotice({ kind: 'err', text: t('password.weak', { min: MIN_PASSWORD }) }); return }
    if (password !== confirm) { setNotice({ kind: 'err', text: t('password.mismatch') }); return }
    const supabase = createClient()
    if (!supabase) { setNotice({ kind: 'err', text: t('password.failed') }); return }
    setPending(true); setNotice(null)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) setNotice({ kind: 'err', text: t(error.code === 'same_password' ? 'password.same' : error.code === 'weak_password' ? 'password.weak' : 'password.failed', { min: MIN_PASSWORD }) })
      else { setNotice({ kind: 'ok', text: t('password.saved') }); setPassword(''); setConfirm('') }
    } catch {
      setNotice({ kind: 'err', text: t('password.failed') })
    }
    setPending(false)
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void save() }} data-password-form>
      <div className={s.cardBody}>
        <div className={s.fieldGrid}>
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-new`}>{t('password.newLabel')}</label>
            <input id={`${id}-new`} className={s.input} type="password" autoComplete="new-password" minLength={MIN_PASSWORD}
              value={password} disabled={pending} onChange={(e) => { setPassword(e.target.value); setNotice(null) }} />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-confirm`}>{t('password.confirmLabel')}</label>
            <input id={`${id}-confirm`} className={s.input} type="password" autoComplete="new-password"
              value={confirm} disabled={pending} onChange={(e) => { setConfirm(e.target.value); setNotice(null) }} />
          </div>
        </div>
      </div>
      <div className={s.foot}>
        {notice && <span role={notice.kind === 'err' ? 'alert' : 'status'} className={s.hint}>{notice.text}</span>}
        <button className={`dx-btn ${s.save}`} type="submit" disabled={pending || !password || !confirm} aria-busy={pending}>
          {pending ? t('orgInfo.saving') : t('password.save')}
        </button>
      </div>
    </form>
  )
}
