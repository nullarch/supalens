'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { classifyKpiStart, type KpiStartResult } from '@/app/app/sources/kpi-start-result'
import type { WizardExtractRequest } from './wizard-extraction-request'
import s from './OnboardingWizard.module.css'

/** Key by source ID: a late reply must never complete a different source's onboarding. */
export function WizardExtraction({ id, name, request, onAccepted, onSkip, onBusyChange }: {
  id: string; name: string; request: WizardExtractRequest; onAccepted: () => void;
  onSkip: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('appWizard.act4')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<KpiStartResult['kind'] | null>(null)
  const lock = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; onBusyChange(false) }
  }, [onBusyChange])
  async function start() {
    if (lock.current || outcome === 'unknown' || outcome === 'running' || outcome === 'accepted') return
    lock.current = true
    setBusy(true)
    onBusyChange(true)
    setOutcome(null)
    try {
      const response = await request(id)
      if (!mounted.current) return
      const result = classifyKpiStart(response.status, response.body)
      setOutcome(result.kind)
      if (result.kind === 'accepted') onAccepted()
    } catch {
      if (mounted.current) setOutcome('unknown')
    } finally {
      lock.current = false
      if (mounted.current) { setBusy(false); onBusyChange(false) }
    }
  }
  return <>
    <div className={s.spread}>
      <header className={s.head}>
        <h2 className={s.title}>{t('titleExtract', { name })}</h2>
        <p className={s.sub}>{t('subExtract')}</p>
      </header>
      <div className={s.stage}>
        <div className={s.hintChips}>
          {['hint1', 'hint2', 'hint3', 'hint4'].map(key => <span key={key} className={s.hintChip}>{t(key)}</span>)}
          <span className={`${s.hintChip} ${s.hintChipMore}`}>{t('hintMore')}</span>
        </div>
        {busy && <p className={s.progress} role="status"><span className={s.replayTagDot} aria-hidden />{t('starting')}</p>}
        {outcome && outcome !== 'accepted' && <div className={s.extractFeedback}>
          <p role={outcome === 'running' ? 'status' : 'alert'} data-outcome={outcome}>{t(`outcome.${outcome}`)}</p>
          {/* A native read-only navigation also works after an uncertain client request. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/app/sources" className={s.ghost}>{t('reviewSources')}</a>
        </div>}
      </div>
    </div>
    <footer className={s.foot}>
      <button type="button" className={s.skip} disabled={busy} onClick={() => { if (!lock.current) onSkip() }}>{t('skip')}</button>
      <button type="button" className={s.primary} disabled={busy || outcome === 'unknown' || outcome === 'running'} onClick={() => void start()}>{busy ? t('starting') : t('startExtract')}</button>
    </footer>
  </>
}
