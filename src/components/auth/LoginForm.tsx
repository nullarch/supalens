'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'

import { createClient } from '@/utils/supabase/client'
import s from './LoginForm.module.css'
import { loginResult, type LoginMethod, type LoginProvider } from './login-result'
import { enabledAuthMethods } from './auth-methods'
import { PasswordLogin } from './PasswordLogin'

function GoogleIcon() {
  return (
    <svg className={s.icon} width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

function KakaoIcon() {
  return (
    <svg className={s.icon} width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#1d1916"
        d="M9 1.5C4.86 1.5 1.5 4.13 1.5 7.38c0 2.1 1.4 3.94 3.5 4.98-.15.55-.56 2.02-.64 2.33-.1.39.14.38.3.28.13-.08 2.02-1.37 2.84-1.93.32.04.65.07.99.07 4.14 0 7.5-2.63 7.5-5.88S13.14 1.5 9 1.5Z"
      />
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg className={s.icon} width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.28-.01-1.04-.02-2.04-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg className={s.fieldIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4 7 8 5.5L20 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export interface LoginFormIO {
  configured: boolean
  social: (provider: LoginProvider, redirectTo: string) => Promise<unknown>
  email: (email: string, redirectTo: string) => Promise<unknown>
}
type LoginNotice = { kind: 'ok' | 'err' | 'neutral'; code: 'emailAcknowledged' | 'redirectReady' | 'emailUnknown' | 'redirectUnknown' | 'rateLimited' | 'invalidRequest' | 'unavailable'; email?: string }

export function LoginForm(props: { next: string; io?: LoginFormIO }) {
  return <LoginController key={props.next} {...props} />
}

function LoginController({ next, io }: { next: string; io?: LoginFormIO }) {
  const t = useTranslations('appAuth')
  const supabase = io ? null : createClient()
  const id = useId()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<LoginMethod | null>(null)
  const [msg, setMsg] = useState<LoginNotice | null>(null)
  const [handoff, setHandoff] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const notice = useRef<HTMLDivElement>(null)
  const origin = useRef<HTMLElement | null>(null)
  const restoreFocus = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (msg && origin.current && document.activeElement === document.body) notice.current?.focus({ preventScroll: true })
  }, [msg])
  useEffect(() => {
    if (!handoff && restoreFocus.current) { restoreFocus.current = false; origin.current?.focus({ preventScroll: true }) }
  }, [handoff])
  const disabled = !!busy || handoff
  const methods = enabledAuthMethods()
  const hasSocial = methods.some((m) => m === 'google' || m === 'kakao' || m === 'github')

  if (io ? !io.configured : !supabase) {
    return (
      <p className={s.notice} role="alert">{t('login.errorNotConfigured')}</p>
    )
  }

  const redirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  async function submit(method: LoginMethod) {
    if (disabled || locked.current || (method === 'email' && !email.trim())) return
    const submittedEmail = email.trim()
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    locked.current = true; setBusy(method); setMsg(null)
    let response: unknown
    try {
      response = method === 'email'
        ? io ? await io.email(submittedEmail, redirectTo()) : await supabase!.auth.signInWithOtp({ email: submittedEmail, options: { emailRedirectTo: redirectTo() } })
        : io ? await io.social(method, redirectTo()) : await supabase!.auth.signInWithOAuth({ provider: method, options: { redirectTo: redirectTo() } })
    } catch { response = undefined }
    if (!mounted.current) return
    const result = loginResult(response, method)
    setBusy(null); locked.current = false
    if (result === 'acknowledged') {
      if (method !== 'email') setHandoff(true)
      setMsg({ kind: method === 'email' ? 'ok' : 'neutral', code: method === 'email' ? 'emailAcknowledged' : 'redirectReady', email: submittedEmail })
    } else setMsg({ kind: 'err', code: result === 'unknown' ? method === 'email' ? 'emailUnknown' : 'redirectUnknown' : result })
  }

  return (
    <div className={s.root} data-login-form>
      <span className="sr-only" role="status">{busy ? busy === 'email' ? t('sending') : t('review.redirectingProvider', { provider: busy === 'google' ? 'Google' : busy === 'kakao' ? 'Kakao' : 'GitHub' }) : ''}</span>
      {methods.includes('google') && (
        <button
          type="button"
          className={s.social}
          disabled={disabled}
          onClick={() => submit('google')}
        >
          {busy === 'google' ? <span className={s.spinner} aria-hidden /> : <GoogleIcon />}
          {busy === 'google' ? t('redirecting') : t('continueGoogle')}
        </button>
      )}

      {methods.includes('kakao') && (
        <button
          type="button"
          className={`${s.social} ${s.kakao}`}
          disabled={disabled}
          onClick={() => submit('kakao')}
        >
          {busy === 'kakao' ? <span className={s.spinner} aria-hidden /> : <KakaoIcon />}
          {busy === 'kakao' ? t('redirecting') : t('continueKakao')}
        </button>
      )}

      {methods.includes('github') && (
        <>
          <button
            type="button"
            className={s.social}
            disabled={disabled}
            onClick={() => submit('github')}
          >
            {busy === 'github' ? <span className={s.spinner} aria-hidden /> : <GithubIcon />}
            {busy === 'github' ? t('redirecting') : t('continueGithub')}
          </button>
          {/* GitHub *login* (Supabase Auth provider) is not the GitHub *App* installation that
              reads repos — say so here, where the confusion starts (docs/github.md). */}
          <p className={s.socialNote}>{t('githubLoginNote')}</p>
        </>
      )}

      {methods.includes('password') && <PasswordLogin next={next} />}

      {methods.includes('email_link') && (hasSocial || methods.includes('password')) && (
        <div className={s.divider}>{t('orEmail')}</div>
      )}

      {methods.includes('email_link') && <form className={s.form} onSubmit={event => { event.preventDefault(); void submit('email') }} aria-busy={busy === 'email'}>
        <label className={s.emailLabel} htmlFor={`${id}-email`}>{t('emailAria')}</label>
        <div className={s.field}>
          <MailIcon />
          <input
            id={`${id}-email`}
            className={s.input}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            disabled={disabled}
            onChange={(e) => { setEmail(e.target.value); setMsg(null) }}
          />
        </div>
        <button type="submit" className={s.submit} disabled={disabled || !email.trim()}>
          {busy === 'email' ? (
            <>
              <span className={s.spinner} aria-hidden /> {t('sending')}
            </>
          ) : (
            t('sendLink')
          )}
        </button>
      </form>}

      {msg && (
        <div
          ref={notice}
          data-login-notice
          tabIndex={-1}
          role={msg.kind === 'err' ? 'alert' : 'status'}
          className={`${s.msg} ${msg.kind === 'ok' ? s.msgOk : msg.kind === 'err' ? s.msgErr : s.msgNeutral}`}
        >
          <span className={s.msgDot} aria-hidden />
          <span>{t(`review.${msg.code}`, { email: msg.email ?? '' })}
            {handoff && <button type="button" className={s.retry} onClick={() => { restoreFocus.current = true; setHandoff(false); setMsg(null) }}>{t('review.retry')}</button>}
          </span>
        </div>
      )}
    </div>
  )
}
