'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import s from '@/components/auth/LoginForm.module.css'
import { completeSetup, type SetupResult } from './actions'

const MIN_PASSWORD = 8
type ErrorCode = Exclude<SetupResult, { ok: true }>['code'] | 'mismatch'

/** Owner account + workspace name for a fresh self-hosted install. */
export function SetupForm() {
  const t = useTranslations('appAuth')
  const id = useId()
  const [workspace, setWorkspace] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  async function submit() {
    if (busy) return
    if (password.length < MIN_PASSWORD) { setError('weak_password'); return }
    if (password !== confirm) { setError('mismatch'); return }
    setBusy(true); setError(null)
    try {
      const result = await completeSetup({ email, password, workspace })
      if (result.ok) { window.location.assign('/app'); return }
      setError(result.code)
    } catch {
      setError('failed')
    }
    setBusy(false)
  }

  const field = (key: string, label: string, input: React.ReactNode) => (
    <>
      <label className={s.emailLabel} htmlFor={`${id}-${key}`}>{label}</label>
      <div className={s.field}>{input}</div>
    </>
  )

  return (
    <form className={s.form} onSubmit={(event) => { event.preventDefault(); void submit() }} aria-busy={busy} data-setup-form>
      {field('workspace', t('setup.workspaceLabel'), (
        <input id={`${id}-workspace`} className={s.input} type="text" autoComplete="organization" maxLength={80}
          placeholder={t('setup.workspacePlaceholder')} value={workspace} disabled={busy}
          onChange={(e) => setWorkspace(e.target.value)} />
      ))}
      {field('email', t('emailAria'), (
        <input id={`${id}-email`} className={s.input} type="email" inputMode="email" autoComplete="email" required
          placeholder="you@example.com" value={email} disabled={busy}
          onChange={(e) => { setEmail(e.target.value); setError(null) }} />
      ))}
      {field('password', t('password.label'), (
        <input id={`${id}-password`} className={s.input} type="password" autoComplete="new-password" required
          minLength={MIN_PASSWORD} value={password} disabled={busy}
          onChange={(e) => { setPassword(e.target.value); setError(null) }} />
      ))}
      {field('confirm', t('setup.confirmLabel'), (
        <input id={`${id}-confirm`} className={s.input} type="password" autoComplete="new-password" required
          value={confirm} disabled={busy}
          onChange={(e) => { setConfirm(e.target.value); setError(null) }} />
      ))}
      <button type="submit" className={s.submit} disabled={busy || !email.trim() || !password || !confirm}>
        {busy ? <><span className={s.spinner} aria-hidden /> {t('password.working')}</> : t('setup.submit')}
      </button>
      {error && (
        <div role="alert" className={`${s.msg} ${s.msgErr}`}>
          <span className={s.msgDot} aria-hidden />
          <span>{t(`setup.errors.${error}`, { min: MIN_PASSWORD })}</span>
        </div>
      )}
    </form>
  )
}
