'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { BOOTSTRAP_METRICS, BOOTSTRAP_PHASES } from '@/lib/bootstrap/events'
import { scanFailed, scanReady, type ScanStatus, type ScanGate, type ScanRequest } from './scan-state'
import s from './setup.module.css'

const PHASE_BADGE: Record<ScanStatus['phases'][keyof ScanStatus['phases']], string> = {
  pending: '', running: 'dx-badge-clay', done: 'dx-badge-success', failed: 'dx-badge-error', skipped: '',
}

/** Every phase/count is supplied by stored status, never interpolated from elapsed time. */
export function ScanProgressView({ dataSourceId, hasRepo, status, requestState = 'idle', gate = null, reading = false, readFailed = false, onStart, onRefresh }: {
  dataSourceId: string; hasRepo: boolean; status: ScanStatus; requestState?: ScanRequest; gate?: ScanGate;
  reading?: boolean; readFailed?: boolean; onStart: () => void; onRefresh: () => void;
}) {
  const t = useTranslations('appSetup')
  const locale = useLocale()
  const failed = scanFailed(status)
  const finished = scanReady(status)
  const empty = finished && status.counts.kpis === 0
  const state = readFailed ? 'unavailable' : requestState === 'submitting' ? 'submitting' : status.active ? 'running' : requestState === 'waiting' ? 'waiting' : failed ? 'failed' : empty ? 'empty' : finished ? 'ready' : 'idle'
  const busy = requestState !== 'idle' || status.active
  const hasProgress = BOOTSTRAP_PHASES.some(p => status.phases[p] !== 'pending')
  // The line is the phases' own reported states, one segment each — never a timer.
  const settled = BOOTSTRAP_PHASES.filter(p => status.phases[p] === 'done' || status.phases[p] === 'skipped').length
  const revealed = (['entities', 'rules', 'kpis'] as const).filter(bucket => status.items[bucket].length > 0)
  return <section className={s.scan} aria-label={t('scan.title')}>
    <p className={s.scanLede}>{t(hasRepo ? 'scan.body' : 'scan.bodySchemaOnly')}</p>

    <div className={s.scanBody}>
      <div className={s.scanTop}>
        <p className={s.scanStatus} data-state={state} role="status">
          <span className={s.scanStatusDot} data-state={state} aria-hidden />
          <span>{t(`scan.state.${state}`)}</span>
        </p>
        <span className={s.scanFraction} aria-hidden>{settled} / {BOOTSTRAP_PHASES.length}</span>
      </div>
      <div className={s.scanLine} aria-hidden>
        {BOOTSTRAP_PHASES.map(p => <span key={p} className={s.scanLineSegment} data-state={status.phases[p]} />)}
      </div>
      <ol className={s.scanPhases} aria-label={t('scan.phasesLabel')}>
        {BOOTSTRAP_PHASES.map((p, i) => <li key={p} className={s.scanPhase} data-state={status.phases[p]} aria-current={status.phases[p] === 'running' ? 'step' : undefined}>
          <span className={s.scanIndex} aria-hidden>{String(i + 1).padStart(2, '0')}</span>
          <span className={s.scanDot} data-state={status.phases[p]} aria-hidden />
          <span className={s.scanPhaseName}>{t(`scan.phase.${p}`)}</span>
          <span className={`dx-badge ${PHASE_BADGE[status.phases[p]]} ${s.scanPhaseState}`}>{t(`scan.phaseState.${status.phases[p]}`)}</span>
        </li>)}
      </ol>
      <dl className={s.scanMetrics} aria-label={t('scan.countsLabel')}>
        {BOOTSTRAP_METRICS.map(m => <div key={m} className={s.scanMetric}>
          <dt className={s.scanMetricLabel}>{t(`scan.metric.${m}`)}</dt>
          <dd className={s.scanMetricVal} data-metric={m} data-known={status.counts[m] != null}>{status.counts[m] == null ? t('scan.pending') : new Intl.NumberFormat(locale).format(status.counts[m])}</dd>
        </div>)}
      </dl>
      {revealed.length > 0 && <div className={s.scanFindings}>
        {revealed.map(bucket => <details key={bucket} className={s.scanReveal} open={bucket !== 'rules'}>
          <summary className={s.scanRevealLabel}>
            <span>{t(`scan.reveal.${bucket}`)}</span>
            <span className={s.scanRevealCount} aria-hidden>{status.items[bucket].length}</span>
          </summary>
          <ul className={s.scanChips}>{status.items[bucket].map((label, i) => <li key={`${bucket}-${i}`} className={s.scanChip}>{label}</li>)}</ul>
        </details>)}
      </div>}
    </div>

    <div className={s.scanNotes}>
      <p className={s.note}>{t('scan.snapshotNote')}</p>
      {status.active && !readFailed && <p className={s.note}>{t('scan.leaveSafe')}</p>}
      {finished && <p className={s.note} data-tone="lead">{t(empty ? 'scan.emptyDone' : 'scan.done')}</p>}
    </div>

    {(failed || gate) && <p className={`dx-announce ${s.notice}`} data-kind={gate === 'limit' || gate === 'quota' || gate === 'conflict' ? 'warning' : 'error'} data-tone={gate === 'limit' || gate === 'quota' || gate === 'conflict' ? 'warning' : 'negative'} role="alert">
      <span>{t(`scan.${gate ?? 'failed'}`)}</span>
      {(gate === 'limit' || gate === 'quota') && <> <Link href="/app/settings/billing" className={s.noticeLink}>{t('scan.limitCta')}</Link></>}
      {gate === 'repository' && <> <Link href="/app/sources" className={s.noticeLink}>{t('scan.repositoryCta')}</Link></>}
    </p>}

    <div className={s.foot}>
      <div className={s.actions}>
        {finished ? <Link href={`/app/sources/${dataSourceId}/kpis`} className="dx-btn">{t(empty ? 'scan.emptyReview' : 'scan.review')}</Link> : <button type="button" className="dx-btn" onClick={onStart} disabled={busy || readFailed || reading}>
          {readFailed ? t('scan.unconfirmed') : requestState === 'submitting' ? t('scan.state.submitting') : requestState === 'waiting' && !status.active ? t('scan.waiting') : busy ? t('scan.running') : failed || hasProgress ? t('scan.retry') : hasRepo ? t('scan.cta') : t('scan.ctaSchemaOnly')}
        </button>}
        <button type="button" className="dx-btn-ghost" onClick={onRefresh} disabled={reading || requestState === 'submitting'}>{reading ? t('scan.refreshing') : t('scan.refresh')}</button>
      </div>
    </div>
  </section>
}
