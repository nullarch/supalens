'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { verifyMonitorRecovery } from '@/lib/alerts/recovery-actions'
import { authorizationAwaitingCheck, checkedRecoveryResult, recoveryAuthorizeHref, recoveryBatch, recoveryGroups, recoveryReturn, recoveryScope, type RecoveryCheckResult, type RecoveryMonitor } from '@/lib/alerts/recovery'
import s from './RecoveryGuide.module.css'

export function RecoveryGuide({ monitors, canManage, canConfigure, verify = verifyMonitorRecovery, refresh, expanded = false }: {
  monitors: readonly RecoveryMonitor[]; canManage: boolean; canConfigure: boolean
  verify?: (id: string) => Promise<RecoveryCheckResult>; refresh?: () => void; expanded?: boolean
}) {
  const t = useTranslations('appRecovery')
  const returning = recoveryReturn(useSearchParams()?.get('recovery'))
  const groups = recoveryGroups(monitors)
  return <>
    {groups.length > 0 && <section id="recovery" className={s.wrap} aria-label={t('heading')} data-recovery-guide>
      <div className={s.heading}>
        <span className={s.signal} aria-hidden />
        <h2 className={s.headingTitle}>{t('heading')}</h2>
        <span className={s.headingMeta}>{t('affected', { count: groups.reduce((n, group) => n + group.monitors.length, 0) })}</span>
      </div>
      {groups.map(group => <RecoveryGroup key={`${group.key}:${recoveryScope(group.monitors)}`}
        group={group} canManage={canManage} canConfigure={canConfigure} verify={verify} refresh={refresh} initialOpen={groups.length === 1 && (expanded || !!returning)} />)}
    </section>}
  </>
}

function RecoveryGroup({ group, canManage, canConfigure, verify, refresh, initialOpen }: {
  group: ReturnType<typeof recoveryGroups>[number]; canManage: boolean; canConfigure: boolean
  verify: (id: string) => Promise<RecoveryCheckResult>; refresh?: () => void; initialOpen: boolean
}) {
  const t = useTranslations('appRecovery')
  const locale = useLocale()
  const router = useRouter()
  const uid = useId()
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, RecoveryCheckResult>>({})
  const [copy, setCopy] = useState<'done' | 'failed' | null>(null)
  const lock = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const first = group.monitors[0]
  const batch = recoveryBatch(group.monitors, results)
  const success = Object.values(results).filter(result => result.ok).length
  const auth = group.kind === 'authorization'
  const awaitingCheck = auth && group.monitors.every(authorizationAwaitingCheck)
    && !Object.values(results).some(result => !result.ok && result.reason === 'authorization')
  const editHref = `/app/monitors?edit=${encodeURIComponent(first.id)}`
  const primaryHref = auth ? group.connectionId ? recoveryAuthorizeHref(group.connectionId, first.id) : '/app/settings/integrations'
    : group.kind === 'sourceRemoved' ? '/app/sources' : editHref
  const allowed = auth || group.kind === 'sourceRemoved' ? canConfigure : canManage
  const request = t('request', { names: group.monitors.map(m => m.name).join(', '), source: first.dataSourceName ?? t('unknownSource'), reason: t(`kinds.${group.kind}.title`) })

  async function run() {
    if (lock.current || !consent || !canManage || !batch.length) return
    lock.current = true
    for (const monitor of batch) {
      if (!mounted.current) break
      setBusy(monitor.id)
      let result: RecoveryCheckResult
      try { result = checkedRecoveryResult(await verify(monitor.id)) } catch { result = { ok: false, reason: 'unconfirmed' } }
      if (mounted.current) setResults(previous => ({ ...previous, [monitor.id]: result }))
    }
    lock.current = false
    if (mounted.current) { setBusy(null); setConsent(false) }
  }

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText(`${request}\n${window.location.origin}/app/monitors/${encodeURIComponent(first.id)}`)
      if (mounted.current) setCopy('done')
    } catch { if (mounted.current) setCopy('failed') }
  }

  return <details className={s.group} open={initialOpen || awaitingCheck || !!busy || Object.keys(results).length > 0} data-recovery-kind={group.kind} data-awaiting-check={awaitingCheck || undefined}>
    <summary className={s.summary}>
      <span className={s.summaryText}>
        <span className={s.summaryTitle}>{t(awaitingCheck ? 'authorizationSaved' : `kinds.${group.kind}.title`)}</span>
        <span className={s.summaryMeta}>{first.dataSourceName ?? t('unknownSource')} · {t('count', { count: group.monitors.length })}</span>
      </span>
      <span className={s.chevron} aria-hidden>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    </summary>
    <div className={s.body}>
      <p className={s.description}>{t(awaitingCheck ? 'authorizationSavedBody' : `kinds.${group.kind}.body`)}</p>
      {!awaitingCheck && <ol className={s.steps}>
        <li><span className={s.stepIndex} aria-hidden>1</span><div><span className={s.stepTitle}>{t('stepIdentify')}</span><p>{auth && group.connectionId ? t('shared') : t('isolated')}</p></div></li>
        <li><span className={s.stepIndex} aria-hidden>2</span><div><span className={s.stepTitle}>{t('stepFix')}</span><p>{t(`kinds.${group.kind}.fix`)}</p></div></li>
        <li><span className={s.stepIndex} aria-hidden>3</span><div><span className={s.stepTitle}>{t('stepVerify')}</span><p>{t('verifyHint')}</p></div></li>
      </ol>}
      {!awaitingCheck && <div className={s.actions}>
        {allowed ? <Link className="dx-btn" href={primaryHref} prefetch={false}>{t(auth ? group.connectionId ? 'reauthorize' : 'inspectConnection' : group.kind === 'sourceRemoved' ? 'inspectSource' : 'editQuery')} <Arrow /></Link>
          : <><span className={s.muted}>{t('adminRequired')}</span><button type="button" className="dx-btn-ghost" onClick={copyRequest}>{t('copyRequest')}</button></>}
        {auth && allowed && <p className={s.muted}>{t('preserved')}</p>}
      </div>}
      {copy && <div role="status" className={s.copyStatus}><p>{t(copy === 'done' ? 'copied' : 'copyFailed')}</p>{copy === 'failed' && <textarea className={s.fallback} aria-label={t('copyRequest')} readOnly value={request} onFocus={event => event.target.select()} />}</div>}
      <ul className={s.monitors} aria-label={t('affected', { count: group.monitors.length })}>
        {group.monitors.map(m => {
          const result = results[m.id]
          return <li key={m.id} data-recovery-result={result ? result.ok ? 'verified' : result.reason : 'waiting'}>
            <Link href={`/app/monitors/${encodeURIComponent(m.id)}`}>{m.name}</Link>
            <span className={s.result} data-tone={result?.ok ? result.conditionMet ? 'warning' : 'success' : 'neutral'} data-busy={busy === m.id || undefined}>
              {busy === m.id ? t('checking') : !m.enabled ? t('paused') : result ? result.ok
                ? t(result.conditionMet ? 'verifiedCondition' : 'verified', { value: new Intl.NumberFormat(locale).format(result.value) })
                : t(`failures.${result.reason}`) : t('notVerified')}
            </span>
          </li>
        })}
      </ul>
      {canManage && batch.length > 0 && <div className={s.verify}>
        <label className={s.consent} htmlFor={`${uid}-consent`}><input id={`${uid}-consent`} type="checkbox" checked={consent} disabled={!!busy} onChange={event => setConsent(event.target.checked)} /><span>{t('consent', { count: batch.length })}</span></label>
        <div className={s.actions}><button type="button" className={awaitingCheck ? 'dx-btn' : 'dx-btn-ghost'} disabled={!consent || !!busy} onClick={run} data-recovery-check>{t(busy ? 'checking' : Object.keys(results).length ? 'retry' : 'check', { count: batch.length })}</button><span className={s.muted}>{t('limit')}</span></div>
      </div>}
      <div className={s.foot} aria-live="polite" aria-atomic="true">
        {Object.keys(results).length > 0 && <p>{t('progress', { count: success, total: group.monitors.filter(m => m.enabled).length })} {t('incidentPreserved')}</p>}
        {!busy && Object.keys(results).length > 0 && <button type="button" className="dx-btn-ghost" onClick={() => (refresh ?? router.refresh)()}>{t('refresh')}</button>}
      </div>
    </div>
  </details>
}

const Arrow = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
