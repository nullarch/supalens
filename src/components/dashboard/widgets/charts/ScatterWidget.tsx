'use client'

import { CartesianGrid, Legend, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { useTranslations } from 'next-intl'
import { formatTick, formatValue } from '@/lib/viz/format'
import type { Format } from '@/lib/viz/spec'
import type { SpecOf, WidgetComponentProps } from '../types'
import { AXIS_STROKE, CHART_MARGIN, CURSOR_STROKE, GRID_STROKE, TICK, axisWidthFor, chartHeight, seriesColor } from '../theme'
import { LEGEND_ICON_SIZE, LEGEND_WRAPPER, legendLabel } from './legend'
import { ChartFrame, useChartAnim } from './ChartFrame'
import { coerceNum } from './data'
import s from './charts.module.css'

type ScatterSpecT = SpecOf<'scatter'>
type Point = { x: number | null; y: number | null; z: number; __series: string }

interface ScatterTooltipProps {
  active?: boolean
  payload?: { payload?: Point }[]
  xFmt: Format
  yFmt: Format
  names: { x: string; y: string; size?: string }
}

/** Scatter needs its OWN tooltip: x, y and bubble-size each have a different
 *  format/label (the shared ClayTooltip would render all three with the y-format). */
function ScatterTooltip({ active, payload, xFmt, yFmt, names }: ScatterTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0]?.payload
  if (!p) return null
  return (
    <div className={s.tooltip}>
      {p.__series && p.__series !== '값' && <div className={s.tooltipLabel}>{p.__series}</div>}
      <div className={s.tooltipRow}>
        <span className={s.tooltipName}>{names.x}</span>
        <span className={s.tooltipVal}>{formatValue(p.x, xFmt)}</span>
      </div>
      <div className={s.tooltipRow}>
        <span className={s.tooltipName}>{names.y}</span>
        <span className={s.tooltipVal}>{formatValue(p.y, yFmt)}</span>
      </div>
      {names.size && (
        <div className={s.tooltipRow}>
          <span className={s.tooltipName}>{names.size}</span>
          <span className={s.tooltipVal}>{formatValue(p.z, { kind: 'number', compact: true })}</span>
        </div>
      )}
    </div>
  )
}

export function ScatterWidget({ spec, data, fill }: WidgetComponentProps<ScatterSpecT>) {
  const t = useTranslations('appDashboards')
  const anim = useChartAnim()
  const xFmt: Format = spec.xFormat ?? { kind: 'number' }
  const yFmt: Format = spec.yFormat ?? { kind: 'number' }

  // group into series (one Scatter per series so colors/legend work)
  const groups = new Map<string, Point[]>()
  const order: string[] = []
  let valid = 0
  let yMax = 0
  for (const r of data.rows) {
    const key = spec.series ? String(r[spec.series] ?? '—') : '값'
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    const x = coerceNum(r[spec.x])
    const y = coerceNum(r[spec.y])
    if (x != null && y != null) {
      valid++
      if (Math.abs(y) > yMax) yMax = Math.abs(y)
    }
    groups.get(key)!.push({
      x,
      y,
      z: spec.size ? (coerceNum(r[spec.size]) ?? 1) : 1,
      __series: key,
    })
  }
  const multi = order.length > 1

  // x/y must be numeric to plot — a row-count-only empty guard can't catch text columns
  if (valid === 0) {
    return <div className={s.note}>{t('widget.needsNumericColumns')}</div>
  }

  const valWidth = axisWidthFor([String(formatValue(yMax, { ...yFmt, compact: true }))])

  return (
    <ChartFrame height={fill ? '100%' : chartHeight(spec)}>
      <ScatterChart margin={{ ...CHART_MARGIN, bottom: 8 }}>
        <CartesianGrid stroke={GRID_STROKE} />
        <XAxis
          type="number"
          dataKey="x"
          name={spec.x}
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: AXIS_STROKE }}
          tickFormatter={(v: number) => formatTick(v, { ...xFmt, compact: true })}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={spec.y}
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={valWidth}
          tickFormatter={(v: number) => formatTick(v, { ...yFmt, compact: true })}
        />
        {spec.size && <ZAxis type="number" dataKey="z" range={[40, 360]} name={spec.size} />}
        <Tooltip
          cursor={{ strokeDasharray: '3 3', stroke: CURSOR_STROKE }}
          content={<ScatterTooltip xFmt={xFmt} yFmt={yFmt} names={{ x: spec.x, y: spec.y, size: spec.size }} />}
        />
        {multi && <Legend verticalAlign="top" align="left" wrapperStyle={LEGEND_WRAPPER} iconType="circle" iconSize={LEGEND_ICON_SIZE} formatter={legendLabel} itemSorter={null} />}
        {order.map((key, i) => (
          <Scatter
            key={key}
            name={key}
            data={groups.get(key)}
            fill={seriesColor(i)}
            fillOpacity={0.7}
            isAnimationActive={anim.isAnimationActive}
            animationDuration={anim.animationDuration}
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  )
}
