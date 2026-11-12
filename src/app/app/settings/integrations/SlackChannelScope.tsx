'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BaseModal, ModalButton } from '@/components/modals'
import { settingsSaveResult } from '../save-result'
import { captureSettingsFocus, restoreSettingsFocus } from '../settings-focus'
import { setSlackAllowedChannelsAction } from './actions'
import s from './integrations.module.css'

/** Channels past this count get a name filter instead of an unbounded wall of chips. */
const FILTER_AFTER = 12

/** Empty allowlist broadens mentions to any channel; unseen saved IDs remain explicit. */
export function SlackChannelScope({ channels, selected, canManage = true, unavailable = false,
  saveAction, refresh, connectionId, readOnlyNote = true,
}: {
  channels: Array<{ id: string; name: string }>; selected: string[]
  canManage?: boolean; unavailable?: boolean
  connectionId?: string
  saveAction?: (ids: string[]) => Promise<unknown>; refresh?: () => void
  /** false when the page already says who can manage connections (no per-row repeat) */
  readOnlyNote?: boolean
}) {
  const t = useTranslations('appIntegrations')
  const common = useTranslations('appCommon')
  const router = useRouter()
  const id = useId()
  const [picked, setPicked] = useState(new Set(selected))
  const [saved, setSaved] = useState(new Set(selected))
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const saveButton = useRef<HTMLButtonElement>(null)
  const container = useRef<HTMLElement>(null)
  const origin = useRef<ReturnType<typeof captureSettingsFocus> | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!pending) { restoreSettingsFocus(origin.current); origin.current = null }
  }, [pending])
  const dirty = picked.size !== saved.size || [...saved].some(value => !picked.has(value))
  const unlisted = [...saved].filter(value => !channels.some(channel => channel.id === value))
  // A real workspace can have hundreds of channels: past a screenful of chips, filter by name.
  const [query, setQuery] = useState('')
  const filterable = channels.length > FILTER_AFTER
  const needle = query.trim().replace(/^#/, '').toLowerCase()
  const shown = filterable && needle ? channels.filter(channel => channel.name.toLowerCase().includes(needle) || picked.has(channel.id)) : channels
  async function save() {
    if (!canManage || unavailable || channels.length === 0 || locked.current || !dirty) return
    const values = [...picked]
    origin.current = captureSettingsFocus()
    locked.current = true; setPending(true); setNotice(null)
    let response: unknown
    try { response = await (saveAction ? saveAction(values) : setSlackAllowedChannelsAction(values, connectionId)) } catch { response = undefined }
    if (!mounted.current) { locked.current = false; return }
    const outcome = settingsSaveResult(response)
    if (outcome.kind === 'confirmed') {
      // A completed save must not depend on a later route refresh to become the baseline.
      setSaved(new Set(values))
      setNotice({ kind: 'ok', text: values.length ? t('page.slackScope.savedLimited', { count: values.length }) : t('page.slackScope.savedReset') })
      setConfirm(false)
      try { (refresh ?? router.refresh)() } catch { setNotice({ kind: 'info', text: t('scopeRefreshFailed') }) }
    } else setNotice({ kind: 'err', text: outcome.kind === 'unconfirmed' ? t('scopeUnconfirmed')
      : [t('page.slackScope.noPermission'), t('page.slackScope.notConnected')].includes(outcome.message ?? '')
        ? outcome.message! : t('page.slackScope.saveFailed') })
    locked.current = false; setPending(false)
  }
  function toggle(value: string) {
    if (!canManage || unavailable || locked.current) return
    setPicked(previous => { const next = new Set(previous); if (next.has(value)) next.delete(value); else next.add(value); return next })
    setNotice(null)
  }
  if (!canManage) return readOnlyNote ? <p className={s.actionNote}>{t('actionReadOnly')}</p> : null
  if (unavailable || channels.length === 0) return <p className={s.actionNote} role="status">{t('scopeUnavailable')}</p>
  return <section ref={container} tabIndex={-1} className={s.channelScope} aria-labelledby={id} data-setting="integration-scope" aria-busy={pending}>
    <div className={s.scopeHead}>
      <h3 id={id}>{t('page.slackScope.label')}</h3>
      {/* the saved (effective) scope, in words — then what an empty selection means */}
      <p className={s.scopeState} data-limited={saved.size > 0 || undefined}>
        {saved.size > 0 ? t('page.slackScope.stateLimited', { count: saved.size }) : t('page.slackScope.stateAll')}
      </p>
      <p className={s.actionNote}>{t('page.slackScope.labelHint')}</p>
    </div>
    {/* the controls column: filter, chips, saved-but-unlisted ids, save */}
    <div className={s.scopeControls}>
      {filterable && <input type="search" className={s.scopeFilter} value={query} onChange={event => setQuery(event.target.value)}
        placeholder={t('page.slackScope.filter')} aria-label={t('page.slackScope.filter')} />}
      <fieldset disabled={pending} className={s.scopeOptions}>
        <legend className={s.scopeLegend}>{t('scopeChoices')}</legend>
        <div className={s.scopeChoices}>
          {shown.map(channel => <label key={channel.id} className={s.scopeOption}>
            <input type="checkbox" checked={picked.has(channel.id)} onChange={() => toggle(channel.id)} />
            <CheckMark />
            <span>#{channel.name}</span>
          </label>)}
        </div>
      </fieldset>
      {unlisted.length > 0 && <div className={s.unlisted}>
        <p className={s.actionNote}>{t('scopeUnlisted')}</p>
        {unlisted.map(value => <label key={value} className={s.scopeOption}>
          <input type="checkbox" disabled={pending} checked={picked.has(value)} onChange={() => toggle(value)} /><CheckMark /><code>{value}</code>
        </label>)}
      </div>}
      <div className={s.scopeFoot}>
        <button ref={saveButton} className="dx-btn" type="button" disabled={pending || !dirty} onClick={() => {
          if (picked.size === 0 && saved.size > 0) { setNotice(null); setConfirm(true) } else void save()
        }}>{pending ? common('processing') : t('page.slackScope.save')}</button>
        {notice && !confirm && <p tabIndex={-1} data-save-notice role={notice.kind === 'err' ? 'alert' : 'status'} className={s.scopeNotice} data-kind={notice.kind}>{notice.text}</p>}
      </div>
    </div>
    <BaseModal open={confirm} title={t('scopeResetTitle')} description={t('scopeResetDescription')}
      onClose={() => { if (!locked.current) setConfirm(false) }} showCloseButton={false} closeDisabled={pending} size="sm"
      onCloseAutoFocus={event => {
        event.preventDefault()
        if (saveButton.current && !saveButton.current.disabled) saveButton.current.focus({ preventScroll: true })
        else container.current?.focus({ preventScroll: true })
      }}
      footer={<div className={s.rowActions}>
        <ModalButton variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>{common('close')}</ModalButton>
        <ModalButton variant="primary" disabled={pending} onClick={save}>{pending ? common('processing') : t('scopeResetTitle')}</ModalButton>
      </div>}>
      {notice?.kind === 'err' && <p role="alert" className={s.streamErr}>{notice.text}</p>}
    </BaseModal>
  </section>
}

/** The drawn check box of a channel chip; the native checkbox over the chip is the real control. */
function CheckMark() {
  return <span className={s.check} aria-hidden>
    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2 5 8.5l4.5-5" /></svg>
  </span>
}
