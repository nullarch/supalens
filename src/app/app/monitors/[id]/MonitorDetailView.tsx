import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { AlertSummary, AlertEventSummary, NotificationTargets } from '@/lib/alerts/server'
import { nextCheckAt, cadenceParts } from '@/lib/alerts/health'
import { monitorDisplayHealth } from '../presentation'
import { expectedRangeLabel, OPERATOR_SYMBOL, type AlertOp } from '@/lib/alerts/evaluate'
import { conditionViewOf } from '@/lib/alerts/condition'
import { conditionBasis, conditionSentence, conditionShort } from '@/lib/alerts/condition-label'
import { formatInOrgTz } from '@/lib/org/timezone'
import { PageHead } from '@/components/dashboard/PageHead'
import { MonitorDetailActions } from './MonitorDetailActions'
import { ExplanationDisclosure } from '../ExplanationDisclosure'
import s from './detail.module.css'
import { RecoveryGuide } from '@/components/feedback/RecoveryGuide'

const DOT = { healthy: 'dx-dot-ok', incident: 'dx-dot-attention', error: 'dx-dot-warning', paused: 'dx-dot-idle', pending: 'dx-dot-idle' } as const
const TAG = { healthy: 'dx-badge-success', incident: 'dx-badge-error', error: 'dx-badge-warning', paused: '', pending: '' } as const

const Arrow = ({ back = false }: { back?: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden className={back ? s.backArrow : undefined}>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * One monitor: back link → title row (serif name, state badge in the lede, actions right) → stat
 * cards (current vs the range it is expected to stay inside as serif figures, then timing) → the
 * evidence (definition, incident history with data facts and AI hypotheses tagged apart) beside
 * the settings and destinations. Presentation only; the route supplies monitor-scoped permissions,
 * cadence and destinations.
 */
export async function MonitorDetailView({ alert, events, targets, timezone, intervalSec, canManage, canConfigure }: {
  alert: AlertSummary; events: AlertEventSummary[]; targets: NotificationTargets; timezone: string;
  intervalSec: number; canManage: boolean; canConfigure: boolean;
}) {
  const t = await getTranslations('appMonitors')
  const locale = await getLocale()
  const intlLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const fmt = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat(intlLocale).format(n))

  const cp = cadenceParts(intervalSec)
  const cadence = cp.unit === 'hours' ? t('cadence.everyHours', { n: cp.n }) : t('cadence.everyMinutes', { n: cp.n })

  const health = monitorDisplayHealth(alert)
  const healthLabel = t(`health.${health}`)
  const typeLabel = t(`type.${alert.type === 'anomaly' ? 'anomaly' : alert.type === 'change_rate' ? 'change_rate' : 'threshold'}`)
  const isAnomaly = alert.type === 'anomaly'
  const next = nextCheckAt(alert, intervalSec)

  const stamp = (iso: string | null): string =>
    formatInOrgTz(iso, timezone, intlLocale, { dateStyle: 'medium', timeStyle: 'short' }) || '—'

  // `alerts.operator` is the FIRING condition ("fire when < 4,000"). Two DIFFERENT statements are
  // shown, never mixed: the range the monitor is expected to stay inside (inverted), and — under
  // its own label — the condition that makes it fire.
  const tc = await getTranslations('appCondition')
  const goalView = alert.condition ? conditionViewOf(alert) : null
  const num = (n: number) => fmt(n)
  let expectedRange = isAnomaly
    ? t('detail.sensitivity', { sigma: alert.sensitivity ?? 3 })
    : expectedRangeLabel(alert.operator as AlertOp, fmt(alert.threshold))
  let firesWhen = isAnomaly
    ? t('detail.sensitivity', { sigma: alert.sensitivity ?? 3 })
    : `${OPERATOR_SYMBOL[alert.operator as AlertOp]} ${fmt(alert.threshold)}`
  // a goal monitor states its structured rule in words (same wording as the approval card)
  if (goalView) {
    expectedRange = conditionShort(goalView, tc, num)
    firesWhen = conditionSentence(goalView, tc, num)
  }
  const basis = goalView ? conditionBasis(goalView, tc) : null

  const destParts: string[] = []
  if (targets.slackChannel) destParts.push(t('dest.slack', { name: targets.slackChannel }))
  else if (targets.slackWebhook) destParts.push(t('dest.slackWebhook'))
  if (targets.discord) destParts.push(t('dest.discord'))
  if (targets.emailCount > 0) destParts.push(t('dest.email', { count: targets.emailCount }))

  const askHref = `/app/ask?q=${encodeURIComponent(alert.name)}`
  const cooldown = t('detail.cooldown', { min: Math.round(alert.cooldownSeconds / 60) })

  const settings: Array<[string, string]> = [
    [t('table.cadence'), cadence],
    [t('form.typeAria'), typeLabel],
    [t('detail.expectedRange'), expectedRange],
    [t('detail.firesWhen'), firesWhen],
    [t('history.fired'), t('detail.consecutive', { n: alert.fireThreshold })],
    [cooldown.split(' ')[0], cooldown],
    [t('detail.createdAt', { date: '' }).trim(), stamp(alert.createdAt)],
  ]

  return (
    <div className={s.wrap}>
      <Link href="/app/monitors" className={s.back}><Arrow back /> {t('detail.back')}</Link>
      <PageHead
        title={alert.name}
        subtitle={
          <span className={s.lede}>
            <span className={`dx-badge ${TAG[health]}`}><span className={`dx-dot ${DOT[health]}`} aria-hidden />{healthLabel}</span>
            <span>{typeLabel}</span>
            {alert.dataSourceName && <span>{t('detail.source')} · {alert.dataSourceName}</span>}
          </span>
        }
        actions={<MonitorDetailActions id={alert.id} name={alert.name} enabled={alert.enabled} canManage={canManage} askHref={askHref} />}
      />

      {/* A broken check leads with its fix, before the (stale) reading. */}
      <RecoveryGuide monitors={[alert]} canManage={canManage} canConfigure={canConfigure} expanded />

      {/* ---- the reading: current vs the range it is expected to stay inside, then timing ---- */}
      <div className={s.stats} data-health={health}>
        <div className={`dx-kpi ${s.stat}`}>
          <div className="dx-kpi-label">{alert.enabled ? t('detail.currentValue') : t('detail.lastRecorded')}</div>
          <div className={`dx-kpi-value ${s.value}`} data-current data-unknown={Boolean(alert.lastError) || alert.lastValue === null}>{alert.lastError ? '—' : fmt(alert.lastValue)}</div>
          {alert.lastError && alert.lastValue !== null && <div className="dx-kpi-delta">{t('detail.lastRecorded')} · {fmt(alert.lastValue)}</div>}
        </div>
        <div className={`dx-kpi ${s.stat}`}>
          <div className="dx-kpi-label">{t('detail.expectedRange')}</div>
          <div className={`dx-kpi-value ${s.value}`}>{expectedRange}</div>
        </div>
        <div className={`dx-kpi ${s.stat}`}>
          <div className="dx-kpi-label">{t('detail.lastChecked')}</div>
          <div className={s.stamp}>{alert.lastCheckedAt ? stamp(alert.lastCheckedAt) : t('row.never')}</div>
        </div>
        <div className={`dx-kpi ${s.stat}`}>
          <div className="dx-kpi-label">{t('detail.nextCheck')}</div>
          <div className={s.stamp}>{next ? stamp(next.toISOString()) : '—'}</div>
          <div className="dx-kpi-delta">{cadence}</div>
        </div>
      </div>

      <div className={s.grid}>
        <div className={s.main}>
          <section className="dx-section" aria-labelledby="monitor-definition-title">
            <div className="dx-section-head">
              <h2 id="monitor-definition-title" className="dx-section-title">{t('detail.definition')}</h2>
            </div>
            <div className={`dx-card ${s.card}`}>
              {alert.goal && <p className={s.goal}><span className={s.goalLabel}>{t('detail.goal')}</span> “{alert.goal}”</p>}
              {goalView && <p className={s.desc}>{firesWhen}{basis ? ` · ${basis}` : ''}</p>}
              <p className={s.desc} data-empty={!alert.description}>{alert.description ?? t('detail.noDescription')}</p>
              <details className={s.details}>
                <summary className={s.summary}>{t('detail.showSql')}</summary>
                <pre className={s.sql}>{alert.metricSql}</pre>
              </details>
            </div>
          </section>

          <section className="dx-section" aria-labelledby="monitor-incidents-title">
            <div className="dx-section-head">
              <h2 id="monitor-incidents-title" className="dx-section-title">{t('detail.incidents')}</h2>
            </div>
            {events.length === 0 ? (
              <div className={`dx-card ${s.empty}`}>
                <p className={s.emptyText}>{t('detail.noIncidents')}</p>
              </div>
            ) : (
              <ol className={`dx-card ${s.timeline}`}>
                {events.map((ev) => (
                  <li key={ev.id} className={s.event} data-kind={ev.kind}>
                    <time className={s.evTime} dateTime={ev.createdAt}>{stamp(ev.createdAt)}</time>
                    <div className={s.evBody}>
                      <div className={s.evHead}>
                        {/* a FIRED event IS an incident — open its triage page (ack / snooze / cause feedback) */}
                        {ev.kind === 'fired' ? (
                          <Link href={`/app/incidents/${ev.id}`} className={s.evLink}>
                            <span className="dx-badge dx-badge-error">{t('history.fired')}</span>
                            <Arrow />
                          </Link>
                        ) : (
                          <span className="dx-badge dx-badge-success">{t('history.resolved')}</span>
                        )}
                        {ev.value !== null && <span className={s.evValue}>{t('detail.valueAt', { value: fmt(ev.value) })}</span>}
                        <span className={s.evNotified} data-on={ev.notified}>{ev.notified ? t('detail.notified') : t('detail.notNotified')}</span>
                      </div>
                      {ev.message && (
                        <div className={s.fact}>
                          <span className="dx-badge dx-badge-clay">{t('detail.confirmed')}</span>
                          <p>{ev.message}</p>
                        </div>
                      )}
                      {ev.explanation && (
                        <ExplanationDisclosure
                          className={s.likely}
                          layout="stacked"
                          text={ev.explanation}
                          label={t('detail.likely')}
                          moreLabel={t('explanation.more')}
                          lessLabel={t('explanation.less')}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <p className={s.note}>{t('detail.seriesNote')}</p>
          </section>
        </div>

        <aside className={s.aside}>
          <section className="dx-section" aria-labelledby="monitor-settings-title">
            <div className="dx-section-head">
              <h2 id="monitor-settings-title" className="dx-section-title">{t('detail.settings')}</h2>
            </div>
            <dl className={`dx-card ${s.dl}`}>
              {settings.map(([label, value]) => (
                <div key={label} className={s.dlRow}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="dx-section" aria-labelledby="monitor-destinations-title">
            <div className="dx-section-head">
              <h2 id="monitor-destinations-title" className="dx-section-title">{t('detail.destinations')}</h2>
              {canConfigure && <Link href="/app/settings/notifications" className="dx-text-link">{t('strip.configure')} <Arrow /></Link>}
            </div>
            <div className={`dx-card ${s.destCard}`}>
              {destParts.length === 0 ? (
                <p className={s.muted}>{t('row.noDestination')}</p>
              ) : (
                <ul className={s.destList}>
                  {destParts.map((d) => <li key={d}>{d}</li>)}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
