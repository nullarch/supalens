'use client'
import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ConnectionActions } from '@/app/app/settings/integrations/ConnectionActions'
import { SlackChannelScope } from '@/app/app/settings/integrations/SlackChannelScope'
import s from '@/app/app/settings/integrations/integrations.module.css'

/** Every action is local; no OAuth, provisioning, teardown, channel write or notification. */
export function IntegrationPreview({ mode }: { mode: string }) {
  const t = useTranslations('appIntegrations')
  const [selected, setSelected] = useState(mode === 'unlisted' ? ['C1', 'SAVED_NOT_LISTED'] : ['C1'])
  const saved = useRef(selected)
  const [calls, setCalls] = useState<Array<{ action: string; value: string | string[] }>>([])
  const delay = () => new Promise(resolve => setTimeout(resolve, mode === 'pending' ? 800 : 50))
  const connectionAction = (action: string) => async (data: FormData) => {
    setCalls(previous => [...previous, { action, value: String(data.get('connectionId')) }])
    await delay()
    if (mode === 'failure') throw new Error('Simulated unconfirmed operation')
  }
  return <>
    <div className={s.providers}>
    {['GitHub', 'Slack', 'Supabase'].map(provider => <section key={provider} className={s.card} aria-label={provider}>
      <div className={s.cardHead}>
      <div className={s.cardIdent}><h2 className={s.cardTitle}>{provider}</h2></div>
      <ConnectionActions connectionId={`sample-${provider}`} name={mode === 'long' ? `${provider} sample connection `.repeat(18) : `${provider} · sample workspace`}
        canManage={mode !== 'viewer'} disconnect={connectionAction(`disconnect-${provider}`)}
        disconnectMessage={t(provider === 'GitHub' ? 'page.github.disconnectConfirm' : provider === 'Slack' ? 'page.slack.disconnectConfirm' : 'page.supabaseCard.disconnectConfirm')}
        resync={provider === 'Supabase' ? connectionAction('resync') : undefined}
        reloadHref="/dev/settings?view=integration-actions&mode=success" />
      </div>
    </section>)}
    </div>
    <div className={s.card} style={{ marginTop: 16, padding: '20px 24px' }}>
    <SlackChannelScope canManage={mode !== 'viewer'} unavailable={mode === 'unavailable'}
      channels={mode === 'empty' ? [] : [{ id: 'C1', name: 'business-alerts' }, { id: 'C2', name: mode === 'long' ? 'sample-long-channel-name-'.repeat(15) : 'engineering' }]}
      selected={selected} saveAction={async values => {
        setCalls(previous => [...previous, { action: 'scope', value: values }]); await delay()
        if (mode === 'throw') throw new Error('Simulated action failure')
        if (mode === 'failure') return { ok: false }
        if (mode === 'malformed') return null
        saved.current = values; return { ok: true }
      }} refresh={() => {
        if (mode === 'refresh-failure') throw new Error('Simulated refresh failure')
        setSelected(saved.current)
      }} />
    </div>
    <details style={{ marginTop: 24 }}><summary>Local fixture calls</summary><output data-integration-calls>{JSON.stringify(calls)}</output></details>
  </>
}
