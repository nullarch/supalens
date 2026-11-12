import { useTranslations } from 'next-intl'
import { computeDelta, formatValue } from '@/lib/viz/format'
import type { SpecOf, WidgetComponentProps } from '../types'
import s from './primitives.module.css'

type KpiSpecT = SpecOf<'kpi'>

export function KpiStat({ spec, data }: WidgetComponentProps<KpiSpecT>) {
  const t = useTranslations('appDashboards')
  const row = data.rows[0] ?? {}
  const value = formatValue(row[spec.value], spec.format)

  let delta: ReturnType<typeof computeDelta> | null = null
  if (spec.comparison) delta = computeDelta(row[spec.value], row[spec.comparison.value])

  const good = spec.comparison?.goodDirection ?? 'up'
  const isGood = delta && delta.direction !== 'flat' ? delta.direction === good : true
  const showDelta = delta && delta.direction !== 'flat'

  const deltaText =
    delta && spec.comparison
      ? spec.comparison.mode === 'percent' && delta.deltaPct != null
        ? formatValue(Math.abs(delta.deltaPct), { kind: 'percent' })
        : formatValue(Math.abs(delta.deltaAbs ?? 0), spec.format)
      : ''

  return (
    <div className={s.kpi}>
      <div className={s.kpiValue}>{value}</div>
      {showDelta && (
        <span className={`${s.kpiDelta} ${isGood ? s.good : s.bad}`}>
          <span className={s.deltaFigure}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden>
              <path
                d={delta!.direction === 'up' ? 'M8 12.5V3.5M4 7l4-3.5L12 7' : 'M8 3.5v9M4 9l4 3.5L12 9'}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {delta!.direction === 'up' ? '+' : '−'}{deltaText}
          </span>
          {/* the Widget header already renders spec.description — keep this to the comparison context only */}
          <span className={s.deltaNote}>{t('widget.vsPrevious')}</span>
        </span>
      )}
      {spec.target != null && (
        <span className={s.kpiTarget}>{t('widget.target', { value: formatValue(spec.target, spec.format) })}</span>
      )}
    </div>
  )
}
