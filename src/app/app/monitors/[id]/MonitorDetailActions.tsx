'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toggleAlert, deleteAlert, testAlert } from '@/lib/alerts/actions'
import { BaseModal } from '@/components/modals/base-modal'
import { monitorActionResult, type MonitorAction } from './action-result'
import s from './actions.module.css'

export interface MonitorDetailIO {
  toggle: (id: string, enabled: boolean) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  test: (id: string) => Promise<unknown>
  refresh: () => void | Promise<void>
  navigate: (href: string) => void | Promise<void>
}
type Props = { id: string; name: string; enabled: boolean; canManage: boolean; askHref: string; io?: MonitorDetailIO }
type Notice = { tone: 'success' | 'error'; text: string }

/** Retains the existing scoped server actions. Keying isolates late replies after navigation. */
export function MonitorDetailActions(props: Props) {
  return <Actions key={props.id} {...props} />
}

function Actions({ id, name, enabled, canManage, askHref, io }: Props) {
  const t = useTranslations('appMonitors')
  const common = useTranslations('appCommon')
  const router = useRouter()
  const actions: MonitorDetailIO = io ?? { toggle: toggleAlert, remove: deleteAlert, test: testAlert, refresh: () => router.refresh(), navigate: href => router.push(href) }
  const [busy, setBusy] = useState<MonitorAction | null>(null)
  const [localEnabled, setLocalEnabled] = useState(enabled)
  const [open, setOpen] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [reload, setReload] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const lock = useRef(false)
  const mounted = useRef(false)
  const recovery = useRef<HTMLDivElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setLocalEnabled(enabled) }, [enabled])

  async function run(action: MonitorAction) {
    if (lock.current || !canManage || unknown || deleted) return
    lock.current = true
    setBusy(action)
    setNotice(null)
    setReload(false)
    const nextEnabled = !localEnabled
    try {
      // Start IO only after acquiring the synchronous duplicate-submit guard.
      const reply = await (action === 'toggle' ? actions.toggle(id, nextEnabled) : action === 'test' ? actions.test(id) : actions.remove(id))
      if (!mounted.current) return
      const result = monitorActionResult(reply, action)
      if (result.kind === 'unknown') throw new Error('Unconfirmed monitor action')
      if (result.kind === 'rejected') {
        setNotice({ tone: 'error', text: t(action === 'test' ? 'notice.testFailed' : 'notice.requestFailed') })
        return
      }
      if (result.kind === 'tested') {
        setNotice({ tone: 'success', text: t('test.result', { detail: result.detail, outcome: t(result.met ? 'test.met' : 'test.unmet') }) })
        return
      }
      if (action === 'delete') {
        setDeleted(true)
        setOpen(false)
        setNotice({ tone: 'success', text: t('notice.deleted') })
        // Navigation failure never erases the saved result or invites another deletion.
        try { await actions.navigate('/app/monitors') } catch { /* native recovery link remains */ }
      } else {
        setLocalEnabled(nextEnabled)
        setNotice({ tone: 'success', text: t(nextEnabled ? 'notice.enabled' : 'notice.disabled') })
        try { await actions.refresh() } catch { if (mounted.current) setReload(true) }
      }
    } catch {
      if (!mounted.current) return
      setUnknown(true)
      setNotice({ tone: 'error', text: t('detailActions.unknown') })
    } finally {
      lock.current = false
      if (mounted.current) setBusy(null)
    }
  }

  const disabled = Boolean(busy) || unknown || deleted
  const feedback = <>
    {notice && <p className={s.notice} data-tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    {reload && <p className={s.notice} role="status">{t('detailActions.refreshFailed')}</p>}
    {(unknown || reload) && <a href={`/app/monitors/${encodeURIComponent(id)}`} className={`dx-btn-ghost ${s.control}`}>{t('detailActions.reload')}</a>}
  </>

  return <div className={s.wrap} data-monitor-detail-actions>
    {!deleted && <div className={s.controls} aria-busy={Boolean(busy)}>
      <Link href={askHref} className={`dx-btn ${s.control}`} aria-disabled={Boolean(busy)} onClick={e => { if (lock.current) e.preventDefault() }}>{t('detail.ask')}</Link>
      {canManage && <span className={s.manage}>
        <button type="button" className={`dx-btn-ghost ${s.control}`} disabled={disabled} onClick={() => void run('test')}>{busy === 'test' ? common('processing') : t('btn.test')}</button>
        <Link href={`/app/monitors?edit=${encodeURIComponent(id)}`} className={`dx-btn-ghost ${s.control}`} aria-disabled={disabled} onClick={e => { if (lock.current || unknown) e.preventDefault() }}>{t('btn.edit')}</Link>
        <button type="button" className={`dx-btn-ghost ${s.control}`} disabled={disabled} onClick={() => void run('toggle')}>{busy === 'toggle' ? common('processing') : t(localEnabled ? 'bulk.pause' : 'bulk.resume')}</button>
        <button type="button" className={`dx-btn-ghost ${s.control} ${s.danger}`} disabled={disabled} onClick={() => { if (!lock.current) { setNotice(null); setOpen(true) } }}>{t('btn.delete')}</button>
      </span>}
    </div>}
    <div className={s.feedback} ref={recovery} tabIndex={-1}>
      {!open && feedback}
      {/* Native GET deliberately recovers when client-side navigation failed. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      {deleted && <a href="/app/monitors" className={`dx-btn-ghost ${s.control}`}>{t('detail.back')}</a>}
    </div>
    <BaseModal open={open} onClose={() => { if (!lock.current) setOpen(false) }} title={t('confirm.delete', { name })} description={t('detailActions.deleteDescription')} showCloseButton={false} closeDisabled={Boolean(busy)} className={s.modal}
      onCloseAutoFocus={event => { if (deleted || unknown) { event.preventDefault(); recovery.current?.focus() } }}
      footer={<>
        <button type="button" className={`dx-btn-ghost ${s.control}`} disabled={Boolean(busy)} onClick={() => { if (!lock.current) setOpen(false) }}>{t('btn.cancel')}</button>
        <button type="button" className={`dx-btn-ghost ${s.control} ${s.danger}`} disabled={disabled} onClick={() => void run('delete')}>{busy === 'delete' ? common('processing') : t('btn.delete')}</button>
      </>}>
      <div className={s.feedback}>{feedback}</div>
    </BaseModal>
  </div>
}
