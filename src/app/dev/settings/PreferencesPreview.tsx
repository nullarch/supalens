'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SettingsView, type SettingsIO } from '@/app/app/settings/SettingsView'
import { DangerZone } from '@/app/app/settings/DangerZone'
import { applySettingsDisplayLocale } from '@/app/app/settings/LanguagePref'
import type { ActionResult } from '@/lib/dashboards/types'

type Saved = { name: string; timezone: string; weekly: boolean; digestOptOut: boolean; alertOptOut: boolean; lifecycleOptOut: boolean }
type Call = { action: string; orgId: string; payload: unknown }

/** Every account operation is replaced with an in-memory response. Danger controls stay inert.
 * locale-live modes exercise only the real local cookie + refresh path, never profile writes. */
export function PreferencesPreview({ mode }: { mode: string }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const t = useTranslations('appSettings')
  const router = useRouter()
  const restored = useRef(false)
  const releases = useRef<Array<() => void>>([])
  const [orgId, setOrgId] = useState('sample-workspace-a')
  const [calls, setCalls] = useState<Call[]>([])
  const [refreshes, setRefreshes] = useState(0)
  const [migrationReady, setMigrationReady] = useState(false)
  const initial = (name: string): Saved => ({ name, timezone: 'UTC', weekly: false, digestOptOut: false, alertOptOut: false, lifecycleOptOut: true })
  const [records, setRecords] = useState<Record<string, Saved>>({
    'sample-workspace-a': initial(mode === 'long' ? 'SampleInternationalWorkspace_'.repeat(8) : 'Sample workspace'),
    'sample-workspace-b': initial('Other sample workspace'),
  })
  const record = records[orgId]
  const canEdit = mode !== 'viewer'
  async function action(name: string, target: string, payload: unknown, patch?: Partial<Saved>): Promise<ActionResult> {
    setCalls(value => [...value, { action: name, orgId: target, payload }])
    if (mode === 'pending' && !restored.current) await new Promise<void>(resolve => releases.current.push(resolve))
    await new Promise(resolve => setTimeout(resolve, 500))
    const current = restored.current ? 'success' : mode
    if (current === 'throw') throw new Error('Sample transport failure')
    if (current === 'malformed') return {} as ActionResult
    if (current === 'unconfigured') return { ok: false, reason: 'unconfigured' }
    if (current === 'failure' || (current === 'locale-live-failure' && name === 'locale')) return { ok: false, reason: 'error', message: 'Sample settings error. ' + 'SampleDiagnostic_'.repeat(12) }
    if (current === 'migration-response' && name === 'timezone') return { ok: false, reason: 'error', message: t('timezone.pendingMigration') }
    if (patch) setRecords(value => ({ ...value, [target]: { ...value[target], ...patch } }))
    return { ok: true, data: undefined }
  }
  const io: SettingsIO = {
    rename: (target, name) => action('rename', target, name, { name: name.trim() }),
    timezone: (target, timezone) => action('timezone', target, timezone, { timezone }),
    email: (target, prefs) => action('email', target, prefs, prefs),
    weekly: (target, weekly) => action('weekly', target, weekly, { weekly }),
    language: {
      persist: locale => action('locale', orgId, locale),
      applyLocale: locale => {
        setCalls(value => [...value, { action: 'display', orgId, payload: locale }])
        if (mode === 'display-failure' && !restored.current) throw new Error('Sample display failure')
        if (mode.startsWith('locale-live')) applySettingsDisplayLocale(locale, () => router.refresh())
      },
    },
    refresh: () => { setRefreshes(value => value + 1); if (mode === 'refresh-failure') throw new Error('Sample refresh failure') },
  }
  return <>
    <div data-settings-ready={ready} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
      <button type="button" className="dx-btn-ghost" onClick={() => { restored.current = true }}>Restore sample responses</button>
      <button type="button" className="dx-btn-ghost" onClick={() => { restored.current = false }}>Reset sample responses</button>
      {mode === 'migration' && <button type="button" className="dx-btn-ghost" onClick={() => setMigrationReady(true)}>Apply sample timezone migration</button>}
      {mode === 'pending' && <button type="button" className="dx-btn-ghost" onClick={() => { restored.current = true; releases.current.forEach(release => release()); releases.current = [] }}>Release pending responses</button>}
      <button type="button" className="dx-btn-ghost" onClick={() => setOrgId(value => value === 'sample-workspace-a' ? 'sample-workspace-b' : 'sample-workspace-a')}>Switch sample workspace</button>
      <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Local refreshes: <span data-refreshes>{refreshes}</span></span>
    </div>
    <SettingsView orgId={orgId} name={record.name} slug={mode === 'long' ? 'sample-international-workspace-'.repeat(12) : orgId}
      timezone={record.timezone} pendingMigration={mode === 'migration' && !migrationReady} canEditOrg={canEdit} isOwner={canEdit}
      weeklyDigestEnabled={record.weekly} digestOptOut={record.digestOptOut} alertOptOut={record.alertOptOut} lifecycleOptOut={record.lifecycleOptOut}
      io={io} danger={<div inert><DangerZone orgId={orgId} orgName={record.name} isOwner={canEdit} /></div>} />
    <details style={{ marginTop: 24, fontSize: 12 }}><summary>Local request log</summary><pre data-settings-calls style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(calls)}</pre></details>
  </>
}
