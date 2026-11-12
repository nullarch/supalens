'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BaseModal, ModalButton } from '@/components/modals'
import { isSelfHosted } from '@/config/edition'
import { deleteOrg, deleteAccount } from '@/lib/org/delete'
import { createClient } from '@/utils/supabase/client'
import { dangerResult, type DangerTarget } from './danger-result'
import s from './settings.module.css'

export interface DangerZoneIO {
  deleteOrg: (orgId: string) => Promise<unknown>
  deleteAccount: () => Promise<unknown>
  signOut: () => Promise<void>
  navigateOrg: () => void
  navigateAccount: () => void
  reloadHref?: string
}
type Props = { orgId: string; orgName: string; isOwner: boolean; io?: DangerZoneIO }
type Notice = { target: DangerTarget; kind: 'blocked' | 'unknown' | 'confirmed'; text: string; destination?: 'billing' | 'members' | 'login' }

/** A changed target/role cannot reuse an earlier typed confirmation or late UI result. */
export function DangerZone(props: Props) {
  return <DangerController key={`${props.orgId}:${props.orgName}:${props.isOwner}`} {...props} />
}

function DangerController({ orgId, orgName, isOwner, io }: Props) {
  const t = useTranslations('appSettings')
  const common = useTranslations('appCommon')
  const router = useRouter()
  const id = useId()
  const [operation, setOperation] = useState<DangerTarget | null>(null)
  const [pending, setPending] = useState<DangerTarget | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [finished, setFinished] = useState<DangerTarget | null>(null)
  const [handoff, setHandoff] = useState<'idle' | 'pending' | 'failed' | 'done'>('idle')
  const [confirmOrg, setConfirmOrg] = useState('')
  const [confirmAccount, setConfirmAccount] = useState('')
  const locked = useRef(false)
  const mounted = useRef(true)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const status = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const sessionCleared = useRef(false)
  const handoffOrigin = useRef<HTMLElement | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (handoff !== 'pending' && handoffOrigin.current && document.activeElement === document.body) status.current?.focus({ preventScroll: true })
  }, [handoff])
  const accountKeyword = t('danger.deleteAccount.keyword')
  const frozen = notice?.kind === 'unknown' || !!finished
  const disabled = !!pending || handoff === 'pending' || frozen
  const allowed = (target: DangerTarget) => target === 'org'
    ? isOwner && !!orgId.trim() && !!orgName.trim() && confirmOrg === orgName
    : !!accountKeyword.trim() && confirmAccount === accountKeyword
  const label = (target: DangerTarget) => t(target === 'org' ? 'danger.deleteOrg.button' : 'danger.deleteAccount.button')

  async function completeNavigation(target: DangerTarget) {
    if (locked.current) return
    handoffOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    locked.current = true; setHandoff('pending')
    try {
      if (target === 'account') {
        if (!sessionCleared.current) {
          if (io) await io.signOut()
          else {
            const client = createClient()
            if (!client) throw new Error('Local session unavailable')
            const result = await client.auth.signOut()
            if (result.error) throw result.error
          }
          sessionCleared.current = true
        }
        if (!mounted.current) return
        if (io) io.navigateAccount(); else window.location.assign('/')
      } else {
        if (io) io.navigateOrg(); else { router.push('/app'); router.refresh() }
      }
      if (mounted.current) setHandoff('done')
    } catch { if (mounted.current) setHandoff('failed') }
    finally { locked.current = false }
  }

  async function execute() {
    if (!operation || disabled || locked.current || !allowed(operation)) return
    const target = operation
    locked.current = true; setPending(target); setNotice(null)
    let response: unknown
    try { response = await (target === 'org' ? io ? io.deleteOrg(orgId) : deleteOrg(orgId) : io ? io.deleteAccount() : deleteAccount()) }
    catch { response = undefined }
    if (!mounted.current) { locked.current = false; return }
    const result = dangerResult(response, target === 'org' ? {
      notOwner: t('danger.deleteOrg.notOwner'), subscription: t('danger.deleteOrg.activeSubscription'),
    } : {
      otherMembers: t('danger.deleteAccount.hasOtherMembers'), subscription: t('danger.deleteAccount.activeSubscription'),
      teardown: t('danger.deleteAccount.teardownFailed'), finalStep: t('danger.deleteAccount.finalStepFailed'),
    })
    if (result.kind === 'confirmed') {
      setFinished(target); setOperation(null)
      setNotice({ target, kind: 'confirmed', text: t('danger.review.confirmed') })
    } else if (result.kind === 'blocked') {
      setNotice({ target, kind: 'blocked', text: t(`danger.review.${result.reason}`), destination:
        result.reason === 'subscription' ? 'billing' : result.reason === 'otherMembers' ? 'members' : result.reason === 'unauthorized' ? 'login' : undefined })
    } else setNotice({ target, kind: 'unknown', text: t(result.kind === 'partial' ? `danger.review.${result.stage}` : 'danger.review.unknown') })
    locked.current = false; setPending(null)
    if (result.kind === 'confirmed') await completeNavigation(target)
  }
  function open(target: DangerTarget, element: HTMLButtonElement) {
    if (disabled || locked.current || !allowed(target)) return
    trigger.current = element; setNotice(null); setOperation(target)
  }
  const noticeContent = notice && <>
    <strong className={s.noticeTitle}>{label(notice.target)}</strong><p>{notice.text}</p>
    {notice.destination && <a href={notice.destination === 'billing' ? '/app/settings/billing' : notice.destination === 'members' ? '/app/settings/members' : '/login?next=/app/settings'}>
      {t(`danger.review.go${notice.destination === 'billing' ? 'Billing' : notice.destination === 'members' ? 'Members' : 'Login'}`)}
    </a>}
    {notice.kind === 'unknown' && <a href={io?.reloadHref ?? '/app/settings'}>{t('danger.review.reload')}</a>}
  </>
  return <div ref={container} tabIndex={-1} className={s.dangerBody} data-danger-zone>
    {(['org', 'account'] as const).filter(target => target === 'account' || (isOwner && !isSelfHosted())).map(target => <section key={target}
      className={s.dangerRow} data-danger-action={target} aria-labelledby={`${id}-${target}-title`} aria-busy={pending === target}>
      <div className={s.dangerCopy}>
        <h3 className={s.dangerTitle} id={`${id}-${target}-title`}>{label(target)}</h3>
        <label htmlFor={`${id}-${target}`} className={s.dangerText}>
          {target === 'org' ? t.rich('danger.deleteOrg.instruction', { b: chunks => <strong className={s.token}>{chunks}</strong>, name: orgName })
            : t.rich('danger.deleteAccount.instruction', { b: chunks => <strong className={s.token}>{chunks}</strong>, word: accountKeyword })}
        </label>
      </div>
      <div className={s.dangerControls}>
        <input id={`${id}-${target}`} className={`${s.input} ${s.dangerInput}`} value={target === 'org' ? confirmOrg : confirmAccount}
          onChange={event => { if (target === 'org') setConfirmOrg(event.target.value); else setConfirmAccount(event.target.value); if (!frozen) setNotice(null) }}
          placeholder={target === 'org' ? orgName : accountKeyword} disabled={disabled} autoComplete="off" spellCheck={false} />
        <button className={`dx-btn-ghost ${s.btnDanger}`} type="button" disabled={disabled || !allowed(target)}
          onClick={event => open(target, event.currentTarget)}>
          {pending === target ? t(target === 'org' ? 'danger.deleteOrg.deleting' : 'danger.deleteAccount.processing') : label(target)}
        </button>
      </div>
    </section>)}
    {notice && !operation && <div ref={status} tabIndex={-1} className={s.dangerNotice} data-kind={notice.kind} role={notice.kind === 'confirmed' ? 'status' : 'alert'}>{noticeContent}</div>}
    {finished && <div className={s.dangerHandoff} aria-live="polite">
      {handoff === 'pending' ? <p>{t('danger.review.finishing')}</p> : <>
        <p>{t(handoff === 'failed' ? 'danger.review.handoffFailed' : 'danger.review.handoffReady')}</p>
        <button type="button" className="dx-btn" onClick={() => void completeNavigation(finished)}>{t('danger.review.continue')}</button>
      </>}
    </div>}
    <BaseModal open={operation !== null} title={operation ? label(operation) : ''}
      description={t(operation === 'org' ? 'danger.review.orgDescription' : 'danger.review.accountDescription')}
      onClose={() => { if (!locked.current) setOperation(null) }} closeDisabled={!!pending} showCloseButton={false} size="sm"
      onCloseAutoFocus={event => {
        event.preventDefault()
        if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus({ preventScroll: true })
        else (status.current ?? container.current)?.focus({ preventScroll: true })
      }}
      footer={<div className={s.dangerButtons}>
        <span className="sr-only" role="status">{pending ? t(pending === 'org' ? 'danger.deleteOrg.deleting' : 'danger.deleteAccount.processing') : ''}</span>
        <ModalButton variant="ghost" disabled={!!pending} onClick={() => setOperation(null)}>{common('close')}</ModalButton>
        <ModalButton variant="destructive" disabled={!!pending || frozen || !operation || !allowed(operation)} onClick={execute}>
          {pending ? common('processing') : operation ? label(operation) : common('confirm')}
        </ModalButton>
      </div>}>
      {operation === 'org' && <p className={s.dangerTarget}>{orgName}</p>}
      {notice && <div className={s.dangerNotice} data-kind={notice.kind} role="alert">{noticeContent}</div>}
    </BaseModal>
  </div>
}
