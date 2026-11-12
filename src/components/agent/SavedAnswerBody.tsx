import { useTranslations } from 'next-intl'
import { WidgetRenderer } from '@/components/dashboard/widgets'
import { isStatSpec, type SavedResult } from './saved-analysis'
import s from './saved-analysis.module.css'

/** No save/share/query controls: these are persisted outputs, not live analyses.
 *  Renders in /app (saved run) AND on the public /share page — the module keeps both looks. */
export function SavedAnswerBody({ result }: { result: SavedResult | null }) {
  const t = useTranslations('appAsk')
  const text = typeof result?.text === 'string' ? result.text : ''
  const visualizations = Array.isArray(result?.visualizations) ? result.visualizations : []
  const stats = visualizations.filter(isStatSpec)
  const charts = visualizations.filter(value => !isStatSpec(value))
  return <>
    {text && <div className={s.prose}>{text}</div>}
    {visualizations.length > 0 && <div className={s.figures}>
      {stats.length > 0 && <div className={s.stats}>{stats.map((spec, i) => <WidgetRenderer key={i} spec={spec} menu={null} />)}</div>}
      {charts.length > 0 && <div className={s.charts}>{charts.map((spec, i) => <WidgetRenderer key={i} spec={spec} menu={null} />)}</div>}
    </div>}
    {!text && visualizations.length === 0 && <p className={s.note}>{t('run.noAnswer')}</p>}
  </>
}
