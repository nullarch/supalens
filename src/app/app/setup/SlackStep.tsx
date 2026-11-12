'use client'

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { setAlertSlackChannel, sendTestNotification } from '@/lib/alerts/actions'
import { Select } from '@/components/ui/Select'
import s from './setup.module.css'

/** Channels a founding team almost always wants alerts in — a hint ordering, never a filter. */
const SUGGESTED = ['general', 'founders', 'alerts']

/** Optional client adapter for isolated design fixtures; production uses the same server actions. */
export interface SlackStepActions {
  saveChannel: typeof setAlertSlackChannel
  sendTest: typeof sendTestNotification
  refresh: () => void
}

export interface SlackStepProps {
  /** Rendered outside the step list (the completion view) → it needs its own heading. */
  standalone?: boolean
  slackAppConfigured: boolean
  slackConnected: boolean
  channels: Array<{ id: string; name: string }>
  selectedChannel: string | null
  canConfigure: boolean
  actions?: SlackStepActions
}

/**
 * The last Golden Path step: where incidents land.
 *
 * Reuses the notification actions rather than re-implementing them — `setAlertSlackChannel` and
 * `sendTestNotification` are the same server actions Settings › Notifications calls, so setup and
 * settings can never disagree about what "the alert channel" is.
 */
export function SlackStep(props: SlackStepProps) {
  const t = useTranslations('appSetup.slack')
  const te = useTranslations('emailAlert')
  const ts = useTranslations('appSetup')
  const router = useRouter()
  const channelId = useId()
  const actions = props.actions ?? { saveChannel: setAlertSlackChannel, sendTest: sendTestNotification, refresh: router.refresh }
  const [pending, startTransition] = useTransition()
  const [channel, setChannel] = useState(props.selectedChannel ?? '')
  const confirmedChannel = useRef(props.selectedChannel ?? '')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err' | 'warning'; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    confirmedChannel.current = props.selectedChannel ?? ''
    setChannel(confirmedChannel.current)
  }, [props.selectedChannel])

  // Suggested channels float to the top; everything else keeps the workspace's own order.
  const options = useMemo(() => {
    const rank = (name: string) => {
      const i = SUGGESTED.indexOf(name.replace(/^#/, '').toLowerCase())
      return i === -1 ? SUGGESTED.length : i
    }
    return [...props.channels]
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
      .map((c) => ({
        value: c.id,
        label: rank(c.name) < SUGGESTED.length ? `#${c.name} · ${t('suggested')}` : `#${c.name}`,
      }))
  }, [props.channels, t])

  const heading = props.standalone ? <SlackHead title={t('title')} lede={t('lede')} stage={ts('stage.notify')} /> : null

  if (!props.slackAppConfigured) {
    return (
      <Root standalone={props.standalone}>
        {heading}
        <div className={s.slackRow}>
          <p className={s.note} data-tone="lead">{t('notConfigured')}</p>
          <p className={s.note}>{t('emailOnlyNote')}</p>
        </div>
        <StartWatching label={t('startWatching')} />
      </Root>
    )
  }

  function save(id: string) {
    if (!props.canConfigure || pending || testing || !id) return
    const name = props.channels.find((c) => c.id === id)?.name ?? id
    setChannel(id)
    setNotice(null)
    startTransition(async () => {
      try {
        const res = await actions.saveChannel(id, name)
        if (res.ok) {
          confirmedChannel.current = id
          setNotice({ kind: 'ok', text: t('saved') })
          actions.refresh()
        } else {
          setChannel(confirmedChannel.current)
          setNotice({ kind: 'err', text: res.message ?? t('saveFailed') })
        }
      } catch {
        setChannel(confirmedChannel.current)
        setNotice({ kind: 'err', text: t('saveFailed') })
      }
    })
  }

  async function test() {
    if (!props.canConfigure || testing || pending) return
    setTesting(true)
    setNotice(null)
    try {
      const res = await actions.sendTest()
      setNotice(res.ok ? {
        kind: res.data.channels && res.data.email ? 'ok' : res.data.channels || res.data.email ? 'warning' : 'err',
        text: t('testResult', {
          channels: t(res.data.channels ? 'channelsAccepted' : 'channelsUnconfirmed'),
          email: t(res.data.email ? 'emailAccepted' : 'emailUnconfirmed'),
        }),
      } : { kind: 'err', text: res.message ?? t('testFailed') })
    } catch {
      setNotice({ kind: 'err', text: t('testFailed') })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Root standalone={props.standalone}>
      {heading}
      {!props.canConfigure && (
        <div className={s.slackRow}>
          <p className={s.note} data-tone="lead">{t('readOnly')}</p>
        </div>
      )}
      {!props.slackConnected ? props.canConfigure && (
        <div className={s.slackRow} data-kind="connect">
          <Link href="/api/connect-slack/authorize?returnTo=/app/setup" className="dx-btn">
            {t('connect')}
          </Link>
        </div>
      ) : (
        <div className={s.slackRow}>
          <label className={s.fieldLabel} htmlFor={channelId}>
            {t('channelLabel')}
          </label>
          <Select
            id={channelId}
            value={channel}
            onValueChange={save}
            options={options}
            placeholder={t('channelPlaceholder')}
            ariaLabel={t('channelLabel')}
            disabled={!props.canConfigure || pending || testing || options.length === 0}
            rootStyle={{ minWidth: 0 }}
            className={s.channelSelect}
            block
          />
          {pending && <p className={s.note} role="status">{t('saving')}</p>}
          {options.length === 0 && <p className={s.note}>{t('noChannels')}</p>}
          <p className={s.note}>{t('mentionNote')}</p>
        </div>
      )}

      {/* The real message shape, so "test" is not the first time anyone sees it. */}
      <div className={s.slackRow}>
        <span className={s.fieldLabel}>{t('previewTitle')}</span>
        <div className={s.preview} role="group" aria-label={t('previewTitle')}>
          <strong className={s.previewTitle}>
            <span className={s.previewDot} aria-hidden />
            {te('headingFired')} · {t('previewName')}
          </strong>
          <div className={s.previewBlock}>
            <span className="dx-badge dx-badge-clay">{te('confirmedInData')}</span>
            <p>{t('previewFacts')}</p>
          </div>
          <div className={s.previewBlock}>
            <span className="dx-badge dx-badge-bloom">{te('likelyCause')}</span>
            <p>{t('previewCause')}</p>
          </div>
          <span className={s.previewButton}>{te('viewButton')}</span>
        </div>
      </div>

      {props.slackConnected && props.canConfigure && (
        <div className={s.slackRow} data-kind="test">
          <div className={s.testRow}>
            <p className={s.note}>{t('testHint')}</p>
            <button type="button" className="dx-btn-ghost" onClick={test} disabled={testing || pending}>
              {testing ? t('testing') : t('test')}
            </button>
          </div>
        </div>
      )}
      {notice && (
        <div className={s.slackRow} data-kind="notice">
          <p className="dx-announce" data-kind={notice.kind} data-tone={notice.kind === 'err' ? 'negative' : notice.kind === 'warning' ? 'warning' : undefined} role={notice.kind === 'ok' ? 'status' : 'alert'}>{notice.text}</p>
        </div>
      )}

      <div className={s.slackRow} data-kind="email">
        <p className={s.note}>
          <strong>{t('emailOnly')}</strong> — {t('emailOnlyNote')}
        </p>
      </div>
      <StartWatching label={t('startWatching')} manage={t('manage')} />
    </Root>
  )
}

/** Standalone (the completion view) the step is its own white card; inside a stage card it is rows. */
function Root({ standalone, children }: { standalone?: boolean; children: ReactNode }) {
  return standalone
    ? <section className={`${s.card} ${s.slack}`} data-kind="slack">{children}</section>
    : <div className={s.slack}>{children}</div>
}

/** Standalone heading (the completion view): step number + stage name, sans title, lede. */
function SlackHead({ title, lede, stage }: { title: string; lede: string; stage: string }) {
  return (
    <div className={s.cardHead}>
      <p className={s.eyebrow}>
        <span className={s.stepNo}>04</span>
        {stage}
      </p>
      <h2 className={s.cardTitle}>{title}</h2>
      <p className={s.cardLede}>{lede}</p>
    </div>
  )
}

function StartWatching({ label, manage }: { label: string; manage?: string }) {
  return (
    <div className={s.foot}>
      <div className={s.actions}>
        <Link href="/app/overview" className="dx-btn">
          {label}
        </Link>
        {manage && (
          <Link href="/app/settings/notifications" className="dx-btn-ghost">
            {manage}
          </Link>
        )}
      </div>
    </div>
  )
}
