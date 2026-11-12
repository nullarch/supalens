'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw, Unplug } from 'lucide-react'
import { BaseModal, ModalButton } from '@/components/modals'
import s from './integrations.module.css'

/** Void action completion does not establish every provider-side cleanup outcome. */
export function ConnectionActions({ connectionId, name, disconnect, disconnectMessage, resync, canManage = true, reloadHref = '/app/settings/integrations', readOnlyNote = true }: {
  connectionId: string; name: string; disconnect: (data: FormData) => Promise<void>
  disconnectMessage: string; resync?: (data: FormData) => Promise<void>; canManage?: boolean
  reloadHref?: string
  /** false when the page already says who can manage connections (no per-row repeat) */
  readOnlyNote?: boolean
}) {
  const t = useTranslations('appIntegrations')
  const common = useTranslations('appCommon')
  const [operation, setOperation] = useState<'disconnect' | 'resync' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [finished, setFinished] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const region = useRef<HTMLDivElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function execute() {
    if (!canManage || !operation || locked.current || error || finished) return
    const action = operation === 'disconnect' ? disconnect : resync
    if (!action) return
    locked.current = true; setPending(true); setError(false); setFinished(false)
    const data = new FormData()
    data.set('connectionId', connectionId)
    try {
      await action(data)
      if (mounted.current) { setFinished(true); setOperation(null) }
    } catch { if (mounted.current) setError(true) }
    finally { locked.current = false; if (mounted.current) setPending(false) }
  }
  if (!canManage) return readOnlyNote ? <p className={s.actionNote}>{t('actionReadOnly')}</p> : null
  return <div ref={region} className={s.connectionActions} tabIndex={-1} aria-busy={pending}>
    <div className={s.rowActions}>
      {resync && <button type="button" className={s.btnGhost} disabled={pending || error || finished} onClick={event => {
        trigger.current = event.currentTarget; setOperation('resync')
      }}><RefreshCw size={14} strokeWidth={2} aria-hidden />{t('page.supabaseCard.resync')}</button>}
      <button type="button" className={s.btnDanger} disabled={pending || error || finished} onClick={event => {
        trigger.current = event.currentTarget; setOperation('disconnect')
      }}><Unplug size={14} strokeWidth={2} aria-hidden />{t('page.disconnect')}</button>
    </div>
    {finished && <p role="status" className={s.actionNote}>{t('actionFinished')}</p>}
    {error && !operation && <p role="alert" className={s.streamErr}>{t('actionUnconfirmed')}</p>}
    {(finished || error) && <a className={s.link} href={reloadHref}>{t('reloadSettings')}</a>}
    <BaseModal open={operation !== null} title={operation === 'resync' ? t('page.supabaseCard.resync') : t('page.disconnect')}
      description={operation === 'resync' ? t('resyncConfirm') : disconnectMessage}
      onClose={() => { if (!locked.current) setOperation(null) }} closeDisabled={pending} showCloseButton={false} size="sm"
      onCloseAutoFocus={event => {
        event.preventDefault()
        if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus({ preventScroll: true })
        else region.current?.focus({ preventScroll: true })
      }}
      footer={<div className={s.rowActions}>
        <ModalButton variant="ghost" disabled={pending} onClick={() => setOperation(null)}>{common('close')}</ModalButton>
        <ModalButton variant={operation === 'disconnect' ? 'destructive' : 'primary'} disabled={pending || error} onClick={execute}>
          {pending ? common('processing') : operation === 'resync' ? t('page.supabaseCard.resync') : t('page.disconnect')}
        </ModalButton>
      </div>}>
      <p className={s.actionTarget}>{name}</p>
      {error && <p className={s.streamErr} role="alert">{t('actionUnconfirmed')}</p>}
    </BaseModal>
  </div>
}
