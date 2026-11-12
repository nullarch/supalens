'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { DangerZone } from '@/app/app/settings/DangerZone'
import type { DangerTarget } from '@/app/app/settings/danger-result'
import s from '@/app/app/settings/settings.module.css'

/** No real deletion, sign-out, navigation, provider cleanup or server action. */
export function DangerPreview({ mode }: { mode: string }) {
  const t = useTranslations('appSettings')
  const [org, setOrg] = useState({ id: 'sample-A', name: mode === 'long' ? 'Northstar sample workspace '.repeat(15) : mode === 'empty-name' ? '' : 'Northstar' })
  const [owner, setOwner] = useState(mode !== 'non-owner')
  const [calls, setCalls] = useState<unknown[]>([])
  const navigationAttempts = useRef(0)
  const signoutAttempts = useRef(0)
  const record = (value: unknown) => setCalls(previous => [...previous, value])
  const remove = async (target: DangerTarget, orgId?: string) => {
    record({ action: target, ...(orgId ? { orgId } : {}) })
    await new Promise(resolve => setTimeout(resolve, mode === 'pending' ? 1000 : 60))
    if (mode === 'throw') throw new Error('private simulated failure')
    if (mode === 'malformed') return { ok: 'true' }
    if (mode === 'failed') return { ok: false, message: 'private simulated failure' }
    if (mode === 'denied') return { ok: false, message: t(target === 'org' ? 'danger.deleteOrg.notOwner' : 'danger.deleteAccount.hasOtherMembers') }
    if (mode === 'subscription') return { ok: false, message: t(target === 'org' ? 'danger.deleteOrg.activeSubscription' : 'danger.deleteAccount.activeSubscription') }
    if (mode === 'unconfigured' || mode === 'unauthorized') return { ok: false, reason: mode }
    if (mode === 'partial' || mode === 'final-step') return { ok: false, message: t(target === 'org' ? 'danger.deleteOrg.failed' : mode === 'partial' ? 'danger.deleteAccount.teardownFailed' : 'danger.deleteAccount.finalStepFailed') }
    return { ok: true }
  }
  const navigate = (action: string) => {
    record(action)
    if (mode === 'handoff-failure' && navigationAttempts.current++ === 0) throw new Error('private simulated navigation failure')
  }
  return <>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
      <button className="dx-btn dx-btn-ghost" onClick={() => setOrg({ id: 'sample-B', name: 'Harbor' })}>Switch sample workspace</button>
      <button className="dx-btn dx-btn-ghost" onClick={() => setOrg(previous => ({ ...previous, name: 'Renamed workspace' }))}>Rename sample workspace</button>
      <button className="dx-btn dx-btn-ghost" onClick={() => setOwner(false)}>Remove sample ownership</button>
    </div>
    <p data-danger-workspace>{org.name}</p>
    <section className={`${s.card} ${s.danger}`} aria-label={t('danger.cardTitle')} data-setting="danger">
      <div className={s.cardHead}><h2 className={s.cardTitle}>{t('danger.cardTitle')}</h2><p className={s.cardDesc}>{t('danger.desc')}</p></div>
      <DangerZone orgId={org.id} orgName={org.name} isOwner={owner} io={{
        deleteOrg: orgId => remove('org', orgId), deleteAccount: () => remove('account'),
        signOut: async () => {
          record('signout')
          if (mode === 'signout-pending') await new Promise(resolve => setTimeout(resolve, 1000))
          if (mode === 'signout-failure' && signoutAttempts.current++ === 0) throw new Error('private simulated signout failure')
        },
        navigateOrg: () => navigate('navigate-org'), navigateAccount: () => navigate('navigate-account'),
        reloadHref: '/dev/settings?view=danger-actions&mode=success',
      }} />
    </section>
    <details><summary>Local fixture calls</summary><output data-danger-calls>{JSON.stringify(calls)}</output></details>
  </>
}
