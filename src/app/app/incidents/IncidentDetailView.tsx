import Link from 'next/link'
import type { ReactNode } from 'react'
import { getLocale, getTranslations } from 'next-intl/server'

import {
  durationParts,
  extractSegments,
  followUpQuestion,
  splitExplanation,
  type Incident,
  type IncidentAlertRow,
} from '@/lib/alerts/incidents'
import { expectedRangeLabel, type AlertOp } from '@/lib/alerts/evaluate'
import { conditionShort } from '@/lib/alerts/condition-label'
import { formatInOrgTz } from '@/lib/org/timezone'
import { PageHead } from '@/components/dashboard/PageHead'
// "Back" returns to the queue, which now lives inside /app/monitors (?view=incidents).
import { monitorsViewHref } from '@/app/app/monitors/view'
import { IncidentTriage } from './IncidentTriage'
import s from './incidents.module.css'

export interface IncidentDetailProps {
  incident: Incident
  alert: IncidentAlertRow
  description: string | null
  metricSql: string | null
  snoozedUntil: string | null
  /** false before `*_incident_ack.sql` is applied — hides the triage card entirely */
  ackReady: boolean
  canManage: boolean
  /** the org's declared display zone (`organizations.timezone`) — every stamp renders in it */
  timezone: string
  /** Local fixture slot; production uses the actual action controller below. */
  triage?: ReactNode
}

const STATUS_TAG = { open: 'dx-badge-error', investigating: '', resolved: 'dx-badge-success' } as const

const Arrow = ({ back = false }: { back?: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden className={back ? s.backArrow : undefined}>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * One incident, at the overview's wide container: back link → title row (serif name, status +
 * severity in the lede, actions right) → stat cards → the account of what happened (investigation,
 * affected segments, timeline) beside what to do about it (triage, the monitor definition). Split
 * out of [id]/page.tsx so /dev/incidents shows the REAL layout.
 *
 * Two honesty constraints shape it: per-check values are not stored (so there is no time series and
 * no "expected band" — only the values recorded when it fired and recovered), and the AI's account
 * is a hypothesis built from the data, never a deployment or log correlation. The "confirmed in
 * data" / "likely cause" split only happens when the explanation text itself carries those markers,
 * and the two are tagged apart (sky badge = data fact, bloom badge = AI hypothesis).
 */
export async function IncidentDetailView({
  incident,
  alert,
  description,
  metricSql,
  snoozedUntil,
  ackReady,
  canManage,
  timezone,
  triage,
}: IncidentDetailProps) {
  const t = await getTranslations('appIncidents')
  const tc = await getTranslations('appCondition')
  const locale = await getLocale()
  const intlLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const num = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat(intlLocale).format(n))
  const stamp = (iso: string | null): string | null =>
    formatInOrgTz(iso, timezone, intlLocale, { dateStyle: 'medium', timeStyle: 'short' }) || null

  const isAnomaly = incident.alertType === 'anomaly'
  const { confirmed, likely } = splitExplanation(incident.explanation)
  const segments = extractSegments(incident.explanation)
  const d = durationParts(incident.durationMs)
  const durationLabel = d.unit === 'lessThanMinute' ? t('duration.lessThanMinute') : t(`duration.${d.unit}`, { n: d.n })
  const askHref = `/app/ask?q=${encodeURIComponent(followUpQuestion(incident, locale, timezone))}`

  // Timeline steps in the order they happen. Only `fired`, `acked` and `resolved` carry a stored
  // timestamp — the investigation and the notification are booleans on the event, so those steps
  // render without a time rather than inventing one.
  const steps: Array<{ key: string; label: string; time: string | null; accent?: boolean }> = [
    { key: 'fired', label: t('timeline.fired'), time: stamp(incident.firedAt), accent: true },
  ]
  if (incident.fireThreshold > 1) {
    steps.push({ key: 'reconfirmed', label: t('timeline.reconfirmed', { n: incident.fireThreshold }), time: null })
  }
  if (incident.explained) steps.push({ key: 'investigated', label: t('timeline.investigated'), time: null })
  if (incident.notified) steps.push({ key: 'notified', label: t('timeline.notified'), time: null })
  if (incident.ack) {
    steps.push({
      key: 'acked',
      label: t('timeline.acked', { kind: t(incident.ack.kind === 'expected' ? 'row.expected' : 'row.acked') }),
      time: stamp(incident.ack.at),
    })
  }
  if (incident.resolvedAt) {
    steps.push({ key: 'resolved', label: t('timeline.resolved'), time: stamp(incident.resolvedAt), accent: true })
  }

  return (
    <div className={s.wrap} data-page-width="wide">
      <Link href={monitorsViewHref('incidents')} className={s.back}>
        <Arrow back /> {t('detail.back')}
      </Link>

      <PageHead
        title={incident.alertName}
        subtitle={
          <span className={s.lede}>
            <span className={`dx-badge ${STATUS_TAG[incident.status]}`}>
              {incident.status === 'investigating' && <span className="dx-dot dx-dot-sync" aria-hidden />}
              {t(`status.${incident.status}`)}
            </span>
            <span className={s.sev} data-level={incident.severity}>
              <span className={s.sevDot} />
              {t(`severity.${incident.severity}`)}
            </span>
            <span className={s.ledeText}>{[incident.dataSourceName, stamp(incident.firedAt), timezone].filter(Boolean).join(' · ')}</span>
          </span>
        }
        actions={
          <div className={s.headActions}>
            <Link href={`/app/monitors/${incident.alertId}`} className={`dx-btn-ghost ${s.control}`}>
              {t('actions.adjust')}
            </Link>
            <Link href={askHref} className={`dx-btn ${s.control}`}>
              {t('actions.ask')}
            </Link>
          </div>
        }
      />

      {/* ---- the reading: the recorded value vs the expected range, then duration and recovery ---- */}
      <div className={s.stats} data-status={incident.status}>
        <div className={`dx-kpi ${s.stat}`}>
          <div className="dx-kpi-label">{t('detail.valueAtFire')}</div>
          <div className={`dx-kpi-value ${s.statValue}`} data-kind="fired">{num(incident.value)}</div>
        </div>
        <div className={`dx-kpi ${s.stat}`}>
          <div className="dx-kpi-label">{isAnomaly ? t('detail.deviation') : t('detail.expectedRange')}</div>
          {/* `alerts.operator` is the FIRING condition, so the EXPECTED range is its inverse — a
              "fires when < ₩4M" monitor is expected to stay "≥ ₩4M", not "< ₩4M". */}
          <div className={`dx-kpi-value ${s.statValue}`}>
            {isAnomaly
              ? incident.zScore === null
                ? '—'
                : t('row.deviation', { z: incident.zScore === Infinity ? '∞' : incident.zScore.toFixed(1) })
              : incident.operator === null
                ? incident.rule ? conditionShort(incident.rule, tc, (n) => num(n)) : '—'
                : expectedRangeLabel(incident.operator as AlertOp, num(incident.threshold))}
          </div>
          {!isAnomaly && incident.changePct !== null && (
            <div className="dx-kpi-delta">
              {t('detail.changePct')} {incident.changePct > 0 ? '+' : ''}
              {incident.changePct.toFixed(1)}%
            </div>
          )}
          {isAnomaly && alert.sensitivity !== null && (
            <div className="dx-kpi-delta">{t('detail.sigma', { sigma: alert.sensitivity })}</div>
          )}
        </div>
        <div className={`dx-kpi ${s.stat}`}>
          <div className="dx-kpi-label">{t('table.duration')}</div>
          <div className={`dx-kpi-value ${s.statValue}`}>{durationLabel}</div>
          {!incident.resolvedAt && <div className="dx-kpi-delta">{t('row.ongoing')}</div>}
        </div>
        <div className={`dx-kpi ${s.stat}`}>
          <div className="dx-kpi-label">{t('detail.valueAtResolve')}</div>
          <div className={`dx-kpi-value ${s.statValue}`}>{incident.resolvedAt ? num(incident.resolvedValue) : '—'}</div>
          {incident.resolvedAt && <div className="dx-kpi-delta">{stamp(incident.resolvedAt)}</div>}
        </div>
      </div>

      <div className={s.grid}>
        <div className={s.main}>
          <section className="dx-section" aria-labelledby="incident-investigation-title">
            <div className="dx-section-head">
              <h2 id="incident-investigation-title" className="dx-section-title">{t('detail.investigation')}</h2>
            </div>
            <div className={`dx-card ${s.card}`}>
              {incident.message && (
                <div className={s.block}>
                  <span className="dx-label">{t('detail.whatChanged')}</span>
                  <p className={s.blockBody}>{incident.message}</p>
                </div>
              )}
              {incident.explanation ? (
                <>
                  {confirmed && (
                    <div className={s.block}>
                      <span className="dx-badge dx-badge-clay">{t('detail.confirmed')}</span>
                      <p className={s.blockBody}>{confirmed}</p>
                    </div>
                  )}
                  <div className={s.block} data-kind="likely">
                    <span className="dx-badge dx-badge-bloom">{likely ? t('detail.likely') : t('detail.hypothesis')}</span>
                    <p className={s.blockBody}>{likely ?? incident.explanation}</p>
                    <p className={s.blockNote}>{t('detail.hypothesisNote')}</p>
                  </div>
                </>
              ) : (
                <div className={s.block}>
                  <p className={s.pending} data-status={incident.status}>
                    {incident.status === 'investigating' && <span className="dx-dot dx-dot-sync" aria-hidden />}
                    {incident.status === 'investigating' ? t('detail.investigating') : t('detail.failed')}
                  </p>
                </div>
              )}
            </div>
            <p className={s.note}>{t('detail.noSeries')}</p>
          </section>

          {segments.length > 0 && (
            <section className="dx-section" aria-labelledby="incident-segments-title">
              <div className="dx-section-head">
                <h2 id="incident-segments-title" className="dx-section-title">{t('detail.segments')}</h2>
              </div>
              <ul className={`dx-card ${s.segments}`}>
                {segments.map((sg) => (
                  <li key={sg.name}>
                    <span className={s.segName}>{sg.name}</span>
                    <span className={s.segValue}>{sg.value}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="dx-section" aria-labelledby="incident-timeline-title">
            <div className="dx-section-head">
              <h2 id="incident-timeline-title" className="dx-section-title">{t('detail.timeline')}</h2>
            </div>
            <ol className={`dx-card ${s.timeline}`}>
              {steps.map((st) => (
                <li key={st.key} className={s.step} data-kind={st.key}>
                  <span className={s.stepDot} aria-hidden />
                  <span className={s.stepLabel}>{st.label}</span>
                  {st.time && <span className={s.stepTime}>{st.time}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className={s.aside}>
          {ackReady && canManage && (
            <section className="dx-section" aria-labelledby="incident-actions-title">
              <div className="dx-section-head">
                <h2 id="incident-actions-title" className="dx-section-title">{t('actions.title')}</h2>
              </div>
              <div className={`dx-card ${s.card}`}>
                {triage ?? <IncidentTriage
                  key={incident.id}
                  eventId={incident.id}
                  ack={incident.ack}
                  feedback={incident.feedback}
                  hasExplanation={Boolean(incident.explanation)}
                  snoozedUntil={snoozedUntil}
                  timezone={timezone}
                />}
              </div>
            </section>
          )}

          <section className="dx-section" aria-labelledby="incident-definition-title">
            <div className="dx-section-head">
              <h2 id="incident-definition-title" className="dx-section-title">{t('detail.definition')}</h2>
              <Link href={`/app/monitors/${incident.alertId}`} className="dx-text-link">
                {t('detail.monitor')} <Arrow />
              </Link>
            </div>
            <div className={`dx-card ${s.card}`}>
              <p className={s.desc} data-empty={!description}>
                {description ?? t('detail.noDescription')}
              </p>
              {metricSql && (
                <details className={s.details}>
                  <summary className={s.summary}>{t('detail.showSql')}</summary>
                  <pre className={s.sql}>{metricSql}</pre>
                </details>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
