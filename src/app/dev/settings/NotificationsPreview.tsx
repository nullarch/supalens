'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { NotificationsManager, type NotificationActions } from '@/app/app/settings/notifications/NotificationsManager'
import type { NotificationConfig } from '@/lib/alerts/server'

/** Local responses only: never post a webhook, send email or invoke a server action. */
export function NotificationsPreview({ mode }: { mode: string }) {
  const t = useTranslations('appNotifications')
  const [config, setConfig] = useState<NotificationConfig>({
    slackWebhook: null, discordWebhook: null,
    slackConnected: !['disconnected', 'unconfigured'].includes(mode),
    slackChannels: [{ id: 'sample-channel', name: mode === 'long' ? 'sample-business-notifications-'.repeat(8) : 'business-alerts' }],
    selectedSlackChannel: 'sample-channel',
    emailRecipients: mode === 'unconfigured' ? [] : [{ userId: 'sample-user', email: mode === 'long' ? `${'sample-address-'.repeat(14)}@example.com` : 'alex@example.com', role: 'owner', optedOut: false },
      { userId: 'sample-optout', email: 'opted-out@example.com', role: 'admin', optedOut: true }],
  })
  const stored = useRef(config)
  const [calls, setCalls] = useState<string[]>([])
  const respond = async (name: string, update?: () => void) => {
    setCalls(previous => [...previous, name])
    await new Promise(resolve => setTimeout(resolve, mode === 'pending' ? 700 : 50))
    if (mode === 'throw') throw new Error('Simulated action failure')
    if (mode === 'failure') return { ok: false, message: t('notice.requestFailed') }
    if (mode === 'malformed') return name === 'test' ? { ok: true, data: { channels: 'yes' } } : {}
    update?.()
    return name === 'test' ? { ok: true, data: {
      channels: !['none', 'email-only'].includes(mode),
      email: !['none', 'channel-only'].includes(mode),
    } } : { ok: true }
  }
  const actions: NotificationActions = {
    setSlackWebhook: value => respond('slack', () => { stored.current = { ...stored.current, slackWebhook: value.trim() || null } }),
    setDiscordWebhook: value => respond('discord', () => { stored.current = { ...stored.current, discordWebhook: value.trim() || null } }),
    setAlertSlackChannel: value => respond('bot', () => { stored.current = { ...stored.current, selectedSlackChannel: value || null } }),
    sendTestNotification: () => respond('test'),
  }
  return <>
    <NotificationsManager config={['viewer', 'unavailable'].includes(mode) ? null : config}
      canConfigure={mode !== 'viewer'} slackAppConfigured={mode !== 'unconfigured'} connectEnabled={false}
      targets={{ slackChannel: config.slackConnected ? config.slackChannels[0].name : null, slackWebhook: !!config.slackWebhook, discord: !!config.discordWebhook, emailCount: config.emailRecipients.filter(r => !r.optedOut).length }}
      actions={actions} refresh={() => {
        setCalls(previous => [...previous, 'refresh'])
        if (mode === 'refresh-failure') throw new Error('Simulated refresh failure')
        setConfig(stored.current)
      }} />
    <details style={{ marginTop: 24 }}><summary>Local fixture calls (no URLs or credentials)</summary><output data-notification-calls>{JSON.stringify(calls)}</output></details>
  </>
}
