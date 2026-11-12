'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { isCloud } from '@/config/edition'
import { createClient } from '@/utils/supabase/client'
import s from './LoginForm.module.css'

type Mode = 'signIn' | 'signUp'
type Notice = { kind: 'ok' | 'err'; code: 'invalidCredentials' | 'weakPassword' | 'confirmEmail' | 'alreadyRegistered' | 'signupDisabled' | 'rateLimited' | 'failed' }

const MIN_PASSWORD = 8

function errorCode(error: { code?: string; status?: number } | null): Notice['code'] {
  switch (error?.code) {
    case 'invalid_credentials': return 'invalidCredentials'
    case 'weak_password': return 'weakPassword'
    case 'user_already_exists':
    case 'email_exists': return 'alreadyRegistered'
    case 'signup_disabled': return 'signupDisabled'
    case 'email_not_confirmed': return 'confirmEmail'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': return 'rateLimited'
    default: return 'failed'
  }
}

/**
 * Email + password sign-in and sign-up. The default method on a self-hosted install: it needs
 * neither an OAuth app nor a mail server (with "Confirm email" off in the Supabase project, a new
 * account is signed in immediately).
 */
export function PasswordLogin({ next }: { next: string }) {
  // Accounts on a self-hosted install are created by an admin; there is no sign-up.
  const canSignUp = isCloud()
  const t = useTranslations('appAuth')
  const id = useId()
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Notice | null>(null)

  async function submit() {
    const supabase = createClient()
    if (!supabase || busy || !email.trim() || !password) return
    if (mode === 'signUp' && password.length < MIN_PASSWORD) { setMsg({ kind: 'err', code: 'weakPassword' }); return }
    setBusy(true); setMsg(null)
    try {
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) { setMsg({ kind: 'err', code: errorCode(error) }); return }
        window.location.assign(next)
        return
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      if (error) { setMsg({ kind: 'err', code: errorCode(error) }); return }
      if (data.session) { window.location.assign(next); return }
      // No session: the project requires email confirmation before the first sign-in.
      setMsg({ kind: 'ok', code: 'confirmEmail' })
    } catch {
      setMsg({ kind: 'err', code: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => { event.preventDefault(); void submit() }} aria-busy={busy} data-password-login>
      <label className={s.emailLabel} htmlFor={`${id}-email`}>{t('emailAria')}</label>
      <div className={s.field}>
        <input
          id={`${id}-email`}
          className={s.input}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          disabled={busy}
          onChange={(e) => { setEmail(e.target.value); setMsg(null) }}
        />
      </div>
      <label className={s.emailLabel} htmlFor={`${id}-password`}>{t('password.label')}</label>
      <div className={s.field}>
        <input
          id={`${id}-password`}
          className={s.input}
          type="password"
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'signUp' ? MIN_PASSWORD : undefined}
          value={password}
          disabled={busy}
          onChange={(e) => { setPassword(e.target.value); setMsg(null) }}
        />
      </div>
      <button type="submit" className={s.submit} disabled={busy || !email.trim() || !password}>
        {busy ? <><span className={s.spinner} aria-hidden /> {t('password.working')}</> : t(mode === 'signIn' ? 'password.signIn' : 'password.signUp')}
      </button>
      {canSignUp && (
        <button type="button" className={s.retry} disabled={busy} onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setMsg(null) }}>
          {t(mode === 'signIn' ? 'password.toSignUp' : 'password.toSignIn')}
        </button>
      )}
      {msg && (
        <div role={msg.kind === 'err' ? 'alert' : 'status'} className={`${s.msg} ${msg.kind === 'ok' ? s.msgOk : s.msgErr}`}>
          <span className={s.msgDot} aria-hidden />
          <span>{t(`password.${msg.code}`, { min: MIN_PASSWORD })}</span>
        </div>
      )}
    </form>
  )
}
