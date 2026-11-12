import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { SavedAnswerBody } from './SavedAnswerBody'
import { SavedTime } from './HistoryView'
import { statusKey, type SavedResult } from './saved-analysis'
import s from './saved-analysis.module.css'

export interface SavedRun {
  question: string; status: string; result: SavedResult | null; error: string | null;
  created_at: string; data_sources: { name: string | null } | null
}

/** One saved run on the 768px reading column: back link, the question as the serif page title,
 *  provenance, the recorded status on a tinted line, then the persisted answer. */
export function SavedRunView({ run }: { run: SavedRun }) {
  const t = useTranslations('appAsk')
  const status = statusKey(run.status)
  return <main className={`${s.page} ${s.answerPage}`}>
    <Link className={`dx-text-link ${s.back}`} href="/app/ask/history">{t('run.back')}</Link>
    <h1 className={s.title}>{run.question}</h1>
    <div className={s.meta}><SavedTime value={run.created_at} /><span>UTC</span>{run.data_sources?.name && <span>{run.data_sources.name}</span>}</div>
    <div className={s.notice} data-state={status} role={status === 'failed' ? 'alert' : 'status'}>
      <span className={s.status} data-state={status}>{t(`history.status.${status}`)}</span>
      <p>{t(status === 'running' || status === 'queued' ? 'run.recordedProgress' : 'run.snapshot')}</p>
      {status === 'failed' && run.error && <p className={s.errorDetail}>{run.error}</p>}
    </div>
    <SavedAnswerBody result={run.result} />
  </main>
}
