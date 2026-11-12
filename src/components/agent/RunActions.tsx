'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link2, Square } from 'lucide-react'
import { BaseModal, ModalButton, TextField } from '@/components/modals'
import { shareRun, unshareRun } from '@/lib/agent/share-actions'
import { track } from '@/utils/analytics'
import { runActionAcknowledgement, shareCreationResult, stopActionResult, type StopResult } from './run-action-result'
import s from './RunActions.module.css'

export interface RunActionIO {
  share: typeof shareRun
  revoke: typeof unshareRun
  copy: (url: string) => Promise<void>
  cancel: (id: string) => Promise<Response>
  track: typeof track
}
const defaultIO: RunActionIO = {
  share: shareRun, revoke: unshareRun, copy: url => navigator.clipboard.writeText(url),
  cancel: id => fetch(`/api/agent/runs/${id}/cancel`, { method: 'POST' }), track,
}

function useRunLifetime() {
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return mounted
}

/** Do not steal focus if the user moved elsewhere while a response was pending. */
function restoreActionFocus(origin: HTMLElement | null, feedback: HTMLElement | null) {
  const dialog = feedback?.closest('[role="dialog"]')
  if (document.activeElement !== document.body && document.activeElement !== origin && document.activeElement !== dialog) return
  if (origin?.isConnected && !origin.matches(':disabled')) origin.focus({ preventScroll: true })
  else feedback?.focus({ preventScroll: true })
}

/** `ghost` = the quiet per-answer action row of the chat (no border until hover). */
export function ShareAction({ runId, actions, variant = 'button' }: { runId: string | null; actions?: RunActionIO; variant?: 'button' | 'ghost' }) {
  return runId ? <ShareControl key={runId} runId={runId} io={actions ?? defaultIO} variant={variant} /> : null
}

function ShareControl({ runId, io, variant }: { runId: string; io: RunActionIO; variant: 'button' | 'ghost' }) {
  const t = useTranslations('appAsk.share')
  const common = useTranslations('appCommon')
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mounted = useRunLifetime()
  const lock = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const feedback = useRef<HTMLParagraphElement>(null)
  const [uncertain, setUncertain] = useState<'create' | 'revoke' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function act(action: 'create' | 'copy' | 'revoke') {
    if (lock.current || !mounted.current || (uncertain && action !== 'revoke') || (action === 'copy' && !url)) return
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    lock.current = true; setBusy(true); setError(null); setNotice(null)
    try {
      if (action === 'create') {
        const result = shareCreationResult(await io.share(runId))
        if (!mounted.current) return
        if (result.kind === 'rejected') { setError(t('createFailed')); return }
        if (result.kind === 'unknown' || !result.url) { setUncertain('create'); setError(t('createUnknown')); return }
        setUrl(result.url); setNotice(t('created'))
        // Telemetry failure cannot revoke a confirmed UI acknowledgement.
        try { void Promise.resolve(io.track('answer_shared')).catch(() => {}) } catch { /* optional telemetry */ }
      } else if (action === 'copy' && url) {
        await io.copy(url)
        if (mounted.current) setNotice(t('copied'))
      } else if (action === 'revoke') {
        const result = runActionAcknowledgement(await io.revoke(runId))
        if (!mounted.current) return
        if (result === 'rejected') { setError(t('revokeFailed')); return }
        if (result === 'unknown') { setUncertain('revoke'); setError(t('revokeUnknown')); return }
        setUrl(null); setUncertain(null); setNotice(t('revoked'))
      }
    } catch {
      if (!mounted.current) return
      if (action !== 'copy') setUncertain(action)
      setError(t(action === 'copy' ? 'copyFailed' : action === 'revoke' ? 'revokeUnknown' : 'createUnknown'))
    } finally {
      if (mounted.current) {
        lock.current = false; setBusy(false)
        requestAnimationFrame(() => { if (mounted.current) restoreActionFocus(origin, feedback.current) })
      }
    }
  }

  return <>
    <button ref={trigger} className={variant === 'ghost' ? s.ghost : s.trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Link2 size={14} aria-hidden />{t('manage')}</button>
    {open && <BaseModal open title={t('manage')} description={t('publicNotice')} className={s.dialog}
      onClose={() => { if (!lock.current) setOpen(false) }} closeDisabled={busy}
      onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}
      footer={<ModalButton variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{common('close')}</ModalButton>}>
      <div className={s.body} aria-busy={busy}>
        {url && !uncertain && <TextField label={t('urlLabel')} value={url} readOnly disabled={busy} onFocus={event => event.target.select()} />}
        {(notice || error) && <p ref={feedback} tabIndex={-1} className={error ? s.error : undefined} role={error ? 'alert' : 'status'}>{error || notice}</p>}
        {busy && <p role="status">{common('processing')}</p>}
        <div className={s.buttons}>
          {url && !uncertain ? <ModalButton disabled={busy} onClick={() => act('copy')}>{t('copy')}</ModalButton> : <ModalButton disabled={busy || !!uncertain} onClick={() => act('create')}>{t('create')}</ModalButton>}
          <ModalButton variant="destructive" disabled={busy} onClick={() => act('revoke')}>{t(uncertain ? 'retryUnshare' : 'unshare')}</ModalButton>
        </div>
        {uncertain && <p className={s.hint}>{t('uncertainHint')}</p>}
        <p className={s.hint}>{t('revokeHint')}</p>
      </div>
    </BaseModal>}
  </>
}

export interface StopRun {
  runId: string | null
  state: 'idle' | 'busy' | StopResult
  /** the stop control may be pressed (idle, or retry after a rejection) */
  enabled: boolean
  label: string
  stop: () => Promise<void>
  feedback: React.RefObject<HTMLParagraphElement | null>
}

/**
 * Stop-a-run state for ONE run at a time. The run it belongs to may change (the chat's composer
 * stops whichever answer is streaming), so a result recorded for an earlier run reads as idle.
 */
export function useStopRun(runId: string | null, actions?: RunActionIO): StopRun {
  const io = actions ?? defaultIO
  const t = useTranslations('appAsk.cancel')
  const [record, setRecord] = useState<{ runId: string | null; state: StopRun['state'] }>({ runId: null, state: 'idle' })
  const state = runId && record.runId === runId ? record.state : 'idle'
  const mounted = useRunLifetime()
  const lock = useRef<string | null>(null)
  const feedback = useRef<HTMLParagraphElement>(null)
  const enabled = !!runId && ['idle', 'rejected'].includes(state)
  async function stop() {
    if (!runId || lock.current === runId || !mounted.current || !enabled) return
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    lock.current = runId; setRecord({ runId, state: 'busy' })
    try {
      const response = await io.cancel(runId)
      const result = await response.json()
      if (mounted.current) setRecord({ runId, state: stopActionResult(response.status, result) })
    } catch { if (mounted.current) setRecord({ runId, state: 'unknown' }) }
    finally {
      if (mounted.current) {
        if (lock.current === runId) lock.current = null
        requestAnimationFrame(() => { if (mounted.current) restoreActionFocus(origin, feedback.current) })
      }
    }
  }
  return { runId, state, enabled, label: t(state === 'busy' ? 'stopping' : 'stop'), stop, feedback }
}

/** The outcome line(s) of a stop request — progress, then the recorded result with a history link. */
export function StopFeedback({ stopper, className }: { stopper: StopRun; className?: string }) {
  const t = useTranslations('appAsk.cancel')
  const { state, runId } = stopper
  if (!runId || state === 'idle') return null
  if (state === 'busy') return <p role="status" className={className}>{t('stopping')}</p>
  const failed = state === 'rejected' || state === 'unknown'
  return <p ref={stopper.feedback} tabIndex={-1} className={[className, failed ? s.error : ''].filter(Boolean).join(' ') || undefined} role={failed ? 'alert' : 'status'}>
    {t(state === 'rejected' ? 'failed' : state === 'unknown' ? 'unknown' : state === 'requested' ? 'requested' : 'terminal')}{' '}
    <Link href={`/app/ask/history/${runId}`}>{t('viewHistory')}</Link>
  </p>
}

export function StopAction({ runId, actions }: { runId: string | null; actions?: RunActionIO }) {
  return runId ? <StopControl key={runId} runId={runId} io={actions ?? defaultIO} /> : null
}

function StopControl({ runId, io }: { runId: string; io: RunActionIO }) {
  const stopper = useStopRun(runId, io)
  return <div className={s.stop} data-run-stop>
    <button type="button" className={s.trigger} data-destructive disabled={!stopper.enabled} onClick={stopper.stop}>
      <Square size={12} aria-hidden />{stopper.label}
    </button>
    <StopFeedback stopper={stopper} />
  </div>
}
