import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'

import { durationParts, firstSentence, splitExplanation, type Incident, type IncidentStatus } from '@/lib/alerts/incidents'
import { expectedRangeLabel, type AlertOp } from '@/lib/alerts/evaluate'
import { conditionShort } from '@/lib/alerts/condition-label'
import { formatInOrgTz } from '@/lib/org/timezone'
import { PageHead } from '@/components/dashboard/PageHead'
// The queue lives inside /app/monitors (?view=incidents) — its own links go back through that route.
import { monitorsViewHref } from '@/app/app/monitors/view'
import s from './incidents.module.css'

/** The filter lives in the URL so a row can be opened and backed out of without losing it. */
export type IncidentFilter = 'openish' | 'open' | 'investigating' | 'resolved' | 'all'
export const INCIDENT_FILTERS: IncidentFilter[] = ['openish', 'open', 'investigating', 'resolved', 'all']

export function parseFilter(v: string | undefined): IncidentFilter {
  return (INCIDENT_FILTERS as string[]).includes(v ?? '') ? (v as IncidentFilter) : 'openish'
}

function matches(inc: Incident, f: IncidentFilter): boolean {
  if (f === 'all') return true
  if (f === 'openish') return inc.status !== 'resolved'
  return inc.status === (f as IncidentStatus)
}

const ClockIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 4.8V8l2.2 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const STATUS_TAG: Record<IncidentStatus, string> = {
  open: 'dx-badge dx-badge-error',
  investigating: 'dx-badge',
  resolved: 'dx-badge dx-badge-success',
}

/**
 * The incidents queue, at the overview's wide container: title row → toolbar (segmented URL filter
 * with counts, the org's display zone on the right — the same toolbar row /app/monitors uses) → one
 * table shell holding the queue. Split out of page.tsx so the dev gallery (/dev/incidents) renders
 * the REAL markup from fixtures instead of a look-alike copy. Rows restack into readable blocks on
 * narrow screens rather than scrolling sideways.
 */
export async function IncidentsTable({
  incidents,
  filter,
  timezone,
}: {
  incidents: Incident[]
  filter: IncidentFilter
  /** the org's declared display zone (`organizations.timezone`) — every stamp renders in it */
  timezone: string
}) {
  const t = await getTranslations('appIncidents')
  const tc = await getTranslations('appCondition')
  const chrome = await getTranslations('appChrome')
  const locale = await getLocale()
  const intlLocale = locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : 'en-US'
  const num = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat(intlLocale).format(n))
  const stamp = (iso: string) =>
    formatInOrgTz(iso, timezone, intlLocale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

  const counts: Record<IncidentFilter, number> = {
    openish: incidents.filter((i) => i.status !== 'resolved').length,
    open: incidents.filter((i) => i.status === 'open').length,
    investigating: incidents.filter((i) => i.status === 'investigating').length,
    resolved: incidents.filter((i) => i.status === 'resolved').length,
    all: incidents.length,
  }
  const rows = incidents.filter((i) => matches(i, filter))
  const tone = (f: IncidentFilter) =>
    counts[f] > 0 && (f === 'openish' || f === 'open') ? 'negative' : undefined

  const durationLabel = (ms: number) => {
    const d = durationParts(ms)
    return d.unit === 'lessThanMinute' ? t('duration.lessThanMinute') : t(`duration.${d.unit}`, { n: d.n })
  }

  return (
    // A queue of operational rows reads better at the overview's wide container than at the 1024px
    // reading column (the shell widens for any page that renders data-page-width="wide").
    <div className={s.list} data-page-width="wide">
      <PageHead title={t('title')} subtitle={t('subtitle')} />

      <div className={s.toolbar}>
        <nav className={`dx-segmented ${s.segmented}`} aria-label={t('filter.aria')}>
          {INCIDENT_FILTERS.map((f) => (
            <Link
              key={f}
              href={monitorsViewHref('incidents', f)}
              data-active={f === filter}
              aria-current={f === filter ? 'page' : undefined}
            >
              {t(`filter.${f}`)}
              <span className={s.count} data-tone={tone(f)}>{counts[f]}</span>
            </Link>
          ))}
        </nav>
        {/* The table's <caption> carries the zone for assistive tech; this is its visible twin. */}
        {rows.length > 0 && (
          <p className={s.zone} aria-hidden>
            <ClockIcon />
            {t('table.timezone', { timezone })}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className={`dx-table-shell ${s.empty}`}>
          <p className={s.emptyText}>{incidents.length === 0 ? t('table.empty') : t('table.emptyFiltered')}</p>
          <div className={s.emptyActions}>
            {incidents.length === 0 ? (
              <Link href="/app/monitors" className="dx-btn">{chrome('nav.monitors')}</Link>
            ) : (
              <Link href={monitorsViewHref('incidents', 'all')} className="dx-btn-ghost">{t('filter.all')}</Link>
            )}
          </div>
        </div>
      ) : (
        <div className={`dx-table-shell ${s.queue}`} role="region" aria-label={t('table.region')}>
          <table className={`dx-table ${s.table}`}>
            <caption className={s.caption}>{t('table.timezone', { timezone })}</caption>
            <colgroup>
              <col className={s.colSeverity} />
              <col />
              <col className={s.colChange} />
              <col className={s.colStarted} />
              <col className={s.colDuration} />
              <col />
              <col className={s.colAck} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{t('table.severity')}</th>
                <th scope="col">{t('table.monitor')}</th>
                <th scope="col">{t('table.change')}</th>
                <th scope="col">{t('table.startedAt')}</th>
                <th scope="col">{t('table.duration')}</th>
                <th scope="col">{t('table.likelyCause')}</th>
                <th scope="col">{t('table.ack')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inc) => {
                // The column promises the LIKELY cause, so lead with the hypothesis block when the
                // explanation carries the markers — not the "confirmed in data" heading that opens it.
                const cause = firstSentence(splitExplanation(inc.explanation).likely ?? inc.explanation)
                return (
                  <tr key={inc.id} className={s.row} data-status={inc.status}>
                    <td className={s.sevCell}>
                      <span className={s.sev} data-level={inc.severity}>
                        <span className={s.sevDot} />
                        {t(`severity.${inc.severity}`)}
                      </span>
                    </td>
                    <td className={s.nameCell}>
                      <Link href={`/app/incidents/${inc.id}`} className={s.rowLink}>
                        {inc.alertName}
                      </Link>
                      <span className={s.meta}>
                        <span className={STATUS_TAG[inc.status]}>
                          {inc.status === 'investigating' && <span className="dx-dot dx-dot-sync" aria-hidden />}
                          {t(`status.${inc.status}`)}
                        </span>
                        {inc.dataSourceName && <span className={s.source}>{inc.dataSourceName}</span>}
                      </span>
                    </td>
                    <td className={s.changeCell} data-label={t('table.change')}>
                      <span className={s.value}>{num(inc.value)}</span>
                      <span className={s.sub}>
                        {/* The row describes a FIRED incident, where the firing condition does hold —
                            but it is stated the same way /app/overview states it: the range the
                            monitor was expected to stay inside ("3.1M · expected ≥ 4M"). */}
                        {inc.alertType === 'anomaly'
                          ? inc.zScore === null
                            ? '—'
                            : t('row.deviation', { z: inc.zScore === Infinity ? '∞' : inc.zScore.toFixed(1) })
                          : inc.operator === null
                            ? inc.rule ? conditionShort(inc.rule, tc, (n) => num(n)) : '—'
                            : t('row.expectedRange', {
                                // no-break space: a narrow column wraps before "≥ 4,000,000", never inside it
                                range: expectedRangeLabel(inc.operator as AlertOp, num(inc.threshold)).replace(' ', '\u00a0'),
                              })}
                      </span>
                    </td>
                    <td className={s.startedCell} data-label={t('table.startedAt')}>
                      <time className={s.time} dateTime={inc.firedAt}>{stamp(inc.firedAt)}</time>
                    </td>
                    <td className={s.durationCell} data-label={t('table.duration')}>
                      <span className={s.duration}>{durationLabel(inc.durationMs)}</span>
                      {!inc.resolvedAt && <span className={s.sub}>{t('row.ongoing')}</span>}
                    </td>
                    <td className={s.causeCell} data-label={t('table.likelyCause')}>
                      {cause ? (
                        <span className={s.cause} title={cause}>
                          {cause}
                        </span>
                      ) : (
                        <span className={`${s.cause} ${s.muted}`}>
                          {inc.status === 'investigating' ? t('row.investigating') : t('row.noExplanation')}
                        </span>
                      )}
                    </td>
                    <td className={s.ackCell}>
                      {inc.ack ? (
                        <span className="dx-badge dx-badge-clay">{t(inc.ack.kind === 'expected' ? 'row.expected' : 'row.acked')}</span>
                      ) : (
                        <span className={s.notAcked}>{t('row.notAcked')}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
