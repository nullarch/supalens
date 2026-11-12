'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { setSlackWebhook, setDiscordWebhook, setAlertSlackChannel, sendTestNotification } from '@/lib/alerts/actions'
import type { NotificationConfig, NotificationTargets } from '@/lib/alerts/server'
import { Select } from '@/components/ui/Select'
import { settingsSaveResult } from '../save-result'
import { captureSettingsFocus, restoreSettingsFocus } from '../settings-focus'
import { notificationTestResult } from './test-result'
import { useIntegrations } from '@/components/integrations/IntegrationsContext'
import s from './notifications.module.css'

const defaultActions = { setSlackWebhook, setDiscordWebhook, setAlertSlackChannel, sendTestNotification }
export type NotificationActions = {
  setSlackWebhook: (value: string) => Promise<unknown>
  setDiscordWebhook: (value: string) => Promise<unknown>
  setAlertSlackChannel: (id: string, name: string) => Promise<unknown>
  sendTestNotification: () => Promise<unknown>
}
type Operation = 'bot' | 'slack' | 'discord' | 'test'

function StatusBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`dx-badge ${on ? 'dx-badge-success' : ''}`}>
      <span className={`dx-dot ${on ? 'dx-dot-ok' : 'dx-dot-idle'}`} />
      {label}
    </span>
  )
}

type ChannelIcon = 'slack' | 'webhook' | 'discord' | 'email'

/** Quiet line glyphs: the channel kind, not third-party brand marks. */
function Glyph({ kind }: { kind: ChannelIcon }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (kind === 'slack') return <svg {...common}><path d="M9 4 7 20M17 4l-2 16M4.5 9h16M3.5 15h16" /></svg>
  if (kind === 'webhook') return <svg {...common}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>
  if (kind === 'discord') return <svg {...common}><path d="M20 15.5a2 2 0 0 1-2 2H8.5L4 21V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" /><path d="M9 11h.01M15 11h.01" strokeWidth={2.4} /></svg>
  return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>
}

export function NotificationsManager({
  canConfigure,
  config,
  targets,
  slackAppConfigured,
  actions = defaultActions,
  refresh,
  connectEnabled = true,
}: {
  canConfigure: boolean
  /** null for members (they may not read posting credentials) */
  config: NotificationConfig | null
  targets: NotificationTargets
  slackAppConfigured: boolean
  actions?: NotificationActions
  refresh?: () => void
  connectEnabled?: boolean
}) {
  const t = useTranslations('appNotifications')
  const integrations = useIntegrations()
  const tm = useTranslations('appMonitors')
  const te = useTranslations('emailAlert')
  const roles = useTranslations('appMembers.role')
  const common = useTranslations('appCommon')
  const id = useId()
  const router = useRouter()
  const [active, setActive] = useState<Operation | null>(null)
  const pending = active !== null
  const [notice, setNotice] = useState<{ section: Operation; kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const [slackUrl, setSlackUrl] = useState(config?.slackWebhook ?? '')
  const [discordUrl, setDiscordUrl] = useState(config?.discordWebhook ?? '')
  const [slackChannel, setSlackChannel] = useState(config?.selectedSlackChannel ?? '')
  const [revealed, setRevealed] = useState({ slack: false, discord: false })
  const [testResult, setTestResult] = useState<ReturnType<typeof notificationTestResult>>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const origin = useRef<ReturnType<typeof captureSettingsFocus> | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!pending) { restoreSettingsFocus(origin.current); origin.current = null } }, [pending])
  const dirty = slackUrl !== (config?.slackWebhook ?? '') || discordUrl !== (config?.discordWebhook ?? '') || slackChannel !== (config?.selectedSlackChannel ?? '')

  async function run(section: Operation, action: () => Promise<unknown>, okText: string) {
    if (!canConfigure || !config || locked.current || (section === 'test' && dirty)) return
    locked.current = true
    origin.current = captureSettingsFocus()
    setActive(section)
    setNotice(null)
    setTestResult(null)
    let response: unknown
    try { response = await action() } catch { response = undefined }
    if (!mounted.current) { locked.current = false; return }
    const outcome = settingsSaveResult(response)
    const result = section === 'test' ? notificationTestResult(response) : null
    if (outcome.kind !== 'confirmed' || (section === 'test' && !result)) {
      setNotice({ section, kind: 'err', text: outcome.kind === 'rejected'
        ? outcome.message ?? t('notice.requestFailed') : t(section === 'test' ? 'testUnconfirmed' : 'saveUnconfirmed') })
    } else {
      if (section === 'test') setTestResult(result)
      else {
        setNotice({ section, kind: 'ok', text: okText })
        try { (refresh ?? router.refresh)() } catch {
          setNotice({ section, kind: 'info', text: t('refreshFailed') })
        }
      }
    }
    locked.current = false
    setActive(null)
  }

  function feedback(section: Operation) {
    return notice?.section === section ? <div data-save-notice tabIndex={-1} role={notice.kind === 'err' ? 'alert' : 'status'} className={s.notice} data-kind={notice.kind}>{notice.text}</div> : null
  }

  const destParts: string[] = []
  if (targets.slackChannel) destParts.push(tm('dest.slack', { name: targets.slackChannel }))
  else if (targets.slackWebhook) destParts.push(tm('dest.slackWebhook'))
  if (targets.discord) destParts.push(tm('dest.discord'))
  if (targets.emailCount > 0) destParts.push(tm('dest.email', { count: targets.emailCount }))

  const channelHead = (key: string, kind: ChannelIcon, title: string, badges: React.ReactNode, desc: string) => (
    <div className={s.channelInfo}>
      <span className={s.glyph}><Glyph kind={kind} /></span>
      <div className={s.channelText}>
        <div className={s.channelTitleRow}>
          <h2 id={`${id}-${key}`} className={s.channelTitle}>{title}</h2>
          <span className={s.badges}>{badges}</span>
        </div>
        <p className={s.desc}>{desc}</p>
      </div>
    </div>
  )

  // Members: the non-secret summary only.
  if (!canConfigure || !config) {
    return (
      <div className={s.col}>
        <section className={s.card} aria-labelledby={`${id}-summary`}>
          <div className={s.cardHead}>
            <h2 id={`${id}-summary`} className={s.cardTitle}>{t('summary.title')}</h2>
            <p className={s.desc}>{t(canConfigure ? 'configUnavailable' : 'readOnly')}</p>
          </div>
          <div className={s.cardBody}>
            {destParts.length === 0 ? <p className={s.emptyLine}>{t('summary.none')}</p> : (
              <ul className={s.destList}>{destParts.map((d) => <li key={d}><span className="dx-dot dx-dot-ok" />{d}</li>)}</ul>
            )}
          </div>
        </section>
      </div>
    )
  }

  const botOn = config.slackConnected && Boolean(config.selectedSlackChannel)

  return (
    <div className={s.col}>
      <div className={s.group}>
        <p className={s.groupLabel}>{t('summary.title')}</p>
        <div className={s.channels}>
          {/* 1 ─ Slack bot channel */}
          <section className={s.channel} data-setting="bot" aria-labelledby={`${id}-bot`}>
            {channelHead('bot', 'slack', t('slackBot.title'),
              <StatusBadge on={config.slackConnected} label={config.slackConnected ? t('status.connected') : t('status.notConnected')} />,
              t('slackBot.desc'))}
            <div className={s.channelBody}>
              {config.slackConnected ? (
                <>
                  <div className={s.field}>
                    <span className={s.label}>{t('slackBot.channel')}</span>
                    <div className={s.controls}>
                      <Select
                        rootClassName={s.selectRoot}
                        className={s.selectTrigger}
                        ariaLabel={t('slackBot.channel')}
                        value={slackChannel}
                        disabled={pending}
                        onValueChange={value => { setSlackChannel(value); setTestResult(null) }}
                        options={[
                          { value: '', label: t('slackBot.noChannel') },
                          ...config.slackChannels.map((c) => ({ value: c.id, label: `#${c.name}` })),
                        ]}
                      />
                      <button
                        className="dx-btn"
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          const name = config.slackChannels.find((c) => c.id === slackChannel)?.name ?? ''
                          void run('bot', () => actions.setAlertSlackChannel(slackChannel, name), slackChannel ? t('slackBot.channelSet', { name }) : t('slackBot.botRemoved'))
                        }}
                      >
                        {active === 'bot' ? common('processing') : t('cta.save')}
                      </button>
                    </div>
                  </div>
                  <p className={s.hint}>{t('slackBot.inviteHint')}</p>
                </>
              ) : slackAppConfigured ? (
                <div className={s.controls}>
                  {connectEnabled ? <Link className="dx-btn" href="/api/connect-slack/authorize?returnTo=/app/settings/notifications">{t('slackBot.connect')}</Link>
                    : <button className="dx-btn" type="button" disabled>{t('slackBot.connect')}</button>}
                </div>
              ) : (
                <p className={s.hint}>{t('slackBot.connectUnavailable')}</p>
              )}
              {feedback('bot')}
            </div>
          </section>

          {/* 2 ─ Slack incoming webhook (fallback) */}
          <section className={s.channel} data-setting="slack" aria-labelledby={`${id}-slack`}>
            {channelHead('slack', 'webhook', t('slackWebhook.title'), <>
              {botOn && <span className="dx-badge">{t('status.fallback')}</span>}
              <StatusBadge on={Boolean(config.slackWebhook)} label={config.slackWebhook ? t('status.configured') : t('status.notConfigured')} />
            </>, t(integrations.slack ? 'slackWebhook.desc' : 'slackWebhook.descPrimary'))}
            <div className={s.channelBody}>
              <div className={s.field}>
                <label className={s.label} htmlFor={`${id}-slack-url`}>{t('webhookUrl')}</label>
                <div className={s.controls}>
                  <input id={`${id}-slack-url`} className={s.input} type={revealed.slack ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={pending} placeholder={t('slackWebhook.placeholder')} value={slackUrl} onChange={(e) => { setSlackUrl(e.target.value); setTestResult(null) }} />
                  <button className="dx-btn-ghost" type="button" disabled={pending} aria-pressed={revealed.slack} onClick={() => setRevealed(v => ({ ...v, slack: !v.slack }))}>{t('revealWebhook')}</button>
                  <button className="dx-btn" type="button" disabled={pending}
                    onClick={() => void run('slack', () => actions.setSlackWebhook(slackUrl), slackUrl.trim() ? t('slackWebhook.saved') : t('slackWebhook.removed'))}>
                    {active === 'slack' ? common('processing') : t('cta.save')}
                  </button>
                </div>
              </div>
              <p className={s.hint}>{t('credentialHint')}</p>
              {feedback('slack')}
            </div>
          </section>

          {/* 3 ─ Discord */}
          <section className={s.channel} data-setting="discord" aria-labelledby={`${id}-discord`}>
            {channelHead('discord', 'discord', t('discord.title'),
              <StatusBadge on={Boolean(config.discordWebhook)} label={config.discordWebhook ? t('status.configured') : t('status.notConfigured')} />,
              t('discord.desc'))}
            <div className={s.channelBody}>
              <div className={s.field}>
                <label className={s.label} htmlFor={`${id}-discord-url`}>{t('webhookUrl')}</label>
                <div className={s.controls}>
                  <input id={`${id}-discord-url`} className={s.input} type={revealed.discord ? 'text' : 'password'} autoComplete="off" spellCheck={false} disabled={pending} placeholder={t('discord.placeholder')} value={discordUrl} onChange={(e) => { setDiscordUrl(e.target.value); setTestResult(null) }} />
                  <button className="dx-btn-ghost" type="button" disabled={pending} aria-pressed={revealed.discord} onClick={() => setRevealed(v => ({ ...v, discord: !v.discord }))}>{t('revealWebhook')}</button>
                  <button className="dx-btn" type="button" disabled={pending}
                    onClick={() => void run('discord', () => actions.setDiscordWebhook(discordUrl), discordUrl.trim() ? t('discord.saved') : t('discord.removed'))}>
                    {active === 'discord' ? common('processing') : t('cta.save')}
                  </button>
                </div>
              </div>
              <p className={s.hint}>{t('credentialHint')}</p>
              {feedback('discord')}
            </div>
          </section>

          {/* 4 ─ Email recipients (read-only: owner/admin verified addresses) */}
          <section className={s.channel} aria-labelledby={`${id}-email`}>
            {channelHead('email', 'email', t('email.title'),
              <StatusBadge on={integrations.email && targets.emailCount > 0} label={integrations.email ? tm('dest.email', { count: targets.emailCount }) : t('email.noTransport')} />,
              t(integrations.email ? 'email.desc' : 'email.descNoTransport'))}
            <div className={s.channelBody}>
              {config.emailRecipients.length === 0 ? <p className={s.emptyLine}>{t('email.none')}</p> : (
                <ul className={s.recipients}>
                  {config.emailRecipients.map((r) => (
                    <li key={r.userId} data-opted-out={r.optedOut || undefined}>
                      <span className={`dx-dot ${r.optedOut ? 'dx-dot-idle' : 'dx-dot-ok'}`} />
                      <span className={s.email}>{r.email}</span>
                      <span className="dx-badge">{['owner', 'admin', 'member', 'viewer'].includes(r.role) ? roles(r.role as 'owner' | 'admin' | 'member' | 'viewer') : r.role}</span>
                      {r.optedOut && <span className={s.optOut}>{t('email.optedOut')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 5 ─ Send test */}
      <section className={s.card} data-setting="test" aria-labelledby={`${id}-test`}>
        <div className={s.cardHead}>
          <h2 id={`${id}-test`} className={s.cardTitle}>{t('test.title')}</h2>
          <p className={s.desc}>{t('test.desc')}</p>
        </div>
        <div className={s.cardBody}>
          <div className={s.controls}>
            <button
              className="dx-btn"
              type="button"
              disabled={pending || dirty}
              onClick={() => void run('test', actions.sendTestNotification, '')}
            >
              {active === 'test' ? t('test.sending') : t('test.button')}
            </button>
          </div>
          {dirty && <p className={s.hint} data-kind="warning">{t('unsavedHint')}</p>}
          {feedback('test')}
          {testResult && <div className={s.testResult} role="status" data-kind={testResult.channels && testResult.email ? 'ok' : 'info'}>
            <dl><div data-sent={testResult.channels}><dt>{t('channelsLabel')}</dt><dd>{t(testResult.channels ? 'channelsAccepted' : 'sendNotConfirmed')}</dd></div>
              <div data-sent={testResult.email}><dt>{t('email.title')}</dt><dd>{t(testResult.email ? 'emailAccepted' : 'sendNotConfirmed')}</dd></div></dl>
            <p>{t('deliveryCaveat')}</p>
          </div>}
        </div>
      </section>

      {/* 6 ─ Message preview: the exact format, facts and hypothesis kept apart */}
      <section className={s.card} aria-labelledby={`${id}-preview`}>
        <div className={s.cardHead}>
          <h2 id={`${id}-preview`} className={s.cardTitle}>{t('preview.title')}</h2>
          <p className={s.desc}>{t('preview.desc')}</p>
          <Link href="/app/monitors" className={s.back}>{tm('detail.back')} <span aria-hidden>→</span></Link>
        </div>
        <div className={s.cardBody}>
          <div className={s.preview} role="group" aria-label={t('preview.title')}>
            <div className={s.pvHead}>
              <span className="dx-dot dx-dot-attention" />
              <span className={s.pvTitle}>{te('headingFired')} · {t('preview.sampleName')}</span>
            </div>
            <div className={s.pvBlock}>
              <span className="dx-badge dx-badge-clay">{te('confirmedInData')}</span>
              <p>{t('preview.sampleBody')}</p>
            </div>
            <div className={s.pvBlock}>
              <span className="dx-badge dx-badge-bloom">{te('likelyCause')}</span>
              <p>{t('preview.sampleCause')}</p>
            </div>
            <div className={s.pvActions}>
              <span className={s.pvButton}>{te('viewButton')}</span>
              <span className={s.pvBrand}>Supalens</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
