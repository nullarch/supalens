import s from './charts.module.css'
import { useTranslations } from 'next-intl'

/** Fixed-height shimmer shown as the next/dynamic loading fallback for chart widgets. */
export function ChartSkeleton({ height = 240 }: { height?: number }) {
  const t = useTranslations('appDashboards')
  return <div className={s.skeleton} style={{ minHeight: height }} aria-busy="true" role="status" aria-label={t('widget.loading')} />
}
