import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { PageHead } from '@/components/dashboard/PageHead'
import { elapsedMs, groupHistory, statusKey, type HistoryRun } from './saved-analysis'
import s from './saved-analysis.module.css'

export function SavedTime({ value }: { value: string }) {
  const format = useFormatter()
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return <span>—</span>
  return <time dateTime={date.toISOString()}>{format.dateTime(date, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}</time>
}

/**
 * Analysis history — one table shell: a tinted head row, a tinted band per inferred conversation
 * (source · origin · turns), then one row per run (question, status dot, UTC timestamp +
 * duration). The origin filter is a segmented control directly above the list.
 */
export function HistoryView({ rows, page, hasNext, channelAvailable, filtered, incidentByRun = {}, loadError = false }: {
  rows: HistoryRun[]; page: number; hasNext: boolean; channelAvailable: boolean; filtered: boolean;
  incidentByRun?: Record<string, string>; loadError?: boolean
}) {
  const t = useTranslations('appAsk')
  const format = useFormatter()
  const pageHref = (n: number) => `/app/ask/history?${filtered ? 'origin=incident&' : ''}page=${n}`
  const groups = groupHistory(rows)
  return <main className={s.page}>
    <PageHead title={t('history.title')} subtitle={t('history.sub')} actions={<Link className="dx-btn" href="/app/ask">{t('history.newRun')}</Link>} />
    <div className={s.toolbar}>
      {channelAvailable && <nav className={s.filters} aria-label={t('history.filter.label')}>
        <span className={s.filterLabel}>{t('history.filter.label')}</span>
        <span className={s.segmented}>
          <Link href="/app/ask/history" aria-current={!filtered ? 'page' : undefined}>{t('history.filter.all')}</Link>
          <Link href="/app/ask/history?origin=incident" aria-current={filtered ? 'page' : undefined}>{t('history.filter.investigations')}</Link>
        </span>
      </nav>}
      <p className={s.note}>{t('history.groupingNote')} {t('history.timezone')}</p>
    </div>
    {loadError ? <div className={s.notice} data-state="failed" role="alert">{t('history.loadFailed')} <a href={pageHref(page)}>{t('history.retry')}</a></div> : groups.length === 0 ?
      <div className={s.emptyState}>
        <p className={s.emptySentence}>{t(filtered ? 'history.noInvestigations' : page > 1 ? 'history.emptyPage' : 'history.empty')}</p>
        <Link className="dx-btn" href={filtered || page > 1 ? '/app/ask/history' : '/app/ask'}>{t(filtered || page > 1 ? 'history.filter.all' : 'history.emptyCta')}</Link>
      </div> :
      <div className={s.list}>
        <div className={s.listHead} aria-hidden>
          <span>{t('history.col.question')}</span><span>{t('history.col.status')}</span><span>{t('history.col.time')}</span>
        </div>
        {groups.map(group => {
          const head = group.runs[0]
          const incident = group.origin === 'incident' ? incidentByRun[head.id] : undefined
          return <section className={s.group} key={head.id} aria-labelledby={`group-${head.id}`}>
            <div className={s.groupHead}>
              <h2 id={`group-${head.id}`}>{head.data_sources?.name ?? '—'}</h2>
              <span className={group.origin === 'incident' ? 'dx-badge dx-badge-bloom' : 'dx-badge'}>{t(`history.origin.${group.origin}`)}</span>
              {incident && <Link className={s.groupLink} href={`/app/incidents/${incident}`}>{t('history.viewIncident')}</Link>}
              <span className={s.groupMeta}>{group.runs.length === 1 ? t('history.group.single') : t('history.group.runs', { count: group.runs.length })}</span>
            </div>
            <ul className={s.runs}>{group.runs.map(run => {
              const duration = elapsedMs(run)
              const durationText = duration === null ? '—' : duration < 1000
                ? t('history.milliseconds', { value: format.number(duration) })
                : t('history.seconds', { value: format.number(duration / 1000, { maximumFractionDigits: 1 }) })
              return <li className={s.row} key={run.id}>
                <Link className={s.question} href={`/app/ask/history/${run.id}`}>{run.question}</Link>
                <span className={s.status} data-state={statusKey(run.status)}>{t(`history.status.${statusKey(run.status)}`)}</span>
                <div className={s.timing}><SavedTime value={run.created_at} /><span>{t('history.duration', { value: durationText })}</span></div>
              </li>
            })}</ul>
          </section>
        })}
      </div>}
    {(page > 1 || hasNext) && <nav className={s.pagination} aria-label={t('history.pagination')}>
      {page > 1 ? <Link className="dx-btn-ghost" href={pageHref(page - 1)}>{t('history.prev')}</Link> : <span />}
      {hasNext && <Link className="dx-btn-ghost" href={pageHref(page + 1)}>{t('history.next')}</Link>}
    </nav>}
  </main>
}
