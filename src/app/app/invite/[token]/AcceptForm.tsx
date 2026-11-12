'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { acceptInvitation } from '@/lib/org/actions'
import { captureSettingsFocus, restoreSettingsFocus } from '../../settings/settings-focus'
import { acceptanceResult, type AcceptResult } from './accept-result'
import s from './invitation.module.css'

export type AcceptInvitationIO = {
  accept: (token: string) => Promise<unknown>
  navigate: () => void | Promise<void>
  reload: () => void | Promise<void>
  home: () => void
}

type Props = { token: string; io?: AcceptInvitationIO }

/** The membership action runs only on explicit confirmation, never on GET/mount.
 * A new token remounts the controller; late results cannot navigate another invite.
 */
export function AcceptForm(props: Props) {
  return <AcceptController key={props.token} {...props} />
}

function AcceptController({ token, io }: Props) {
  const t = useTranslations('appMembers.accept')
  const router = useRouter()
  const [pending, setPending] = useState<'accept' | 'navigate' | 'reload' | null>(null)
  const [result, setResult] = useState<AcceptResult | null>(null)
  const [navigationFailed, setNavigationFailed] = useState(false)
  const [reloadFailed, setReloadFailed] = useState(false)
  const locked = useRef(false)
  const latestResult = useRef<AcceptResult | null>(null)
  const mounted = useRef(true)
  const origin = useRef<ReturnType<typeof captureSettingsFocus> | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!pending) { restoreSettingsFocus(origin.current); origin.current = null }
  }, [pending, result])
  const frozen = result?.kind === 'accepted' || result?.kind === 'unconfirmed'
  const blocked = result?.kind === 'rejected' && result.reason !== 'error'

  async function navigate() {
    setPending('navigate')
    setNavigationFailed(false)
    try {
      if (io) await io.navigate()
      else { router.push('/app/settings/members'); router.refresh() }
    } catch {
      if (mounted.current) setNavigationFailed(true)
    }
    // A router request returning does not prove the destination has rendered.
  }

  async function onAccept() {
    const latest = latestResult.current
    if (locked.current || latest?.kind === 'accepted' || latest?.kind === 'unconfirmed' || (latest?.kind === 'rejected' && latest.reason !== 'error') || !token.trim()) return
    locked.current = true
    origin.current = captureSettingsFocus()
    setPending('accept'); setResult(null); setReloadFailed(false)
    try {
      let response: unknown
      try { response = await (io ? io.accept(token) : acceptInvitation(token)) }
      catch { response = null }
      if (!mounted.current) return
      const next = acceptanceResult(response)
      latestResult.current = next
      setResult(next)
      if (next.kind === 'accepted') await navigate()
    } finally {
      locked.current = false
      if (mounted.current) setPending(null)
    }
  }

  async function onRecovery(action: 'navigate' | 'reload') {
    if (locked.current || (action === 'navigate' && latestResult.current?.kind !== 'accepted')) return
    locked.current = true
    origin.current = captureSettingsFocus()
    try {
      if (action === 'navigate') await navigate()
      else {
        setPending('reload'); setReloadFailed(false)
        try { if (io) await io.reload(); else window.location.reload() }
        catch { if (mounted.current) setReloadFailed(true) }
      }
    } finally {
      locked.current = false
      if (mounted.current) setPending(null)
    }
  }

  const rejectedCopy = result?.kind === 'rejected'
    ? t(result.reason === 'unauthorized' ? 'sessionUnavailable' : result.reason === 'unconfigured' ? 'serviceUnavailable' : result.reason === 'not_found' ? 'notFound' : 'rejected')
    : ''
  const notice = result?.kind === 'accepted' ? t('accepted')
    : result?.kind === 'unconfirmed' ? t('unconfirmed') : rejectedCopy

  return <div data-invitation-form data-setting="invitation">
    {notice && <p className={s.notice} data-kind={result?.kind} data-save-notice tabIndex={-1} role={result?.kind === 'accepted' ? 'status' : 'alert'}>{notice}</p>}
    {navigationFailed && <p className={s.notice} data-kind="navigation" role="alert">{t('navigationFailed')}</p>}
    {reloadFailed && <p className={s.notice} data-kind="navigation" role="alert">{t('reloadFailed')}</p>}
    {pending && <p className={s.help} role="status">{t(pending === 'accept' ? 'accepting' : pending === 'navigate' ? 'opening' : 'reloading')}</p>}
    <div className={s.actions}>
      {result?.kind === 'accepted'
        ? <button className="dx-btn" type="button" disabled={!!pending} onClick={() => void onRecovery('navigate')}>{t('viewMembers')}</button>
        : <button className="dx-btn" type="button" disabled={!!pending || frozen || blocked || !token.trim()} onClick={() => void onAccept()}>{t(pending === 'accept' ? 'accepting' : 'confirm')}</button>}
      {(result?.kind === 'unconfirmed' || result?.kind === 'rejected') && <button className="dx-btn-ghost" type="button" disabled={!!pending} onClick={() => void onRecovery('reload')}>{t('reload')}</button>}
      {pending
        ? <button className="dx-btn-ghost" type="button" disabled>{t('home')}</button>
        : <Link className="dx-btn-ghost" href="/app" prefetch={false} onClick={event => {
          if (locked.current) { event.preventDefault(); return }
          if (io) { event.preventDefault(); io.home() }
        }}>{t('home')}</Link>}
    </div>
    {!result && <p className={s.footnote}>{t('confirmHelp')}</p>}
  </div>
}
