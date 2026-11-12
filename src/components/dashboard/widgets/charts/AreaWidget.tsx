'use client'

import { useId } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { formatTick, formatValue } from '@/lib/viz/format'
import type { Format } from '@/lib/viz/spec'
import type { SpecOf, WidgetComponentProps } from '../types'
import { AXIS_STROKE, CHART_MARGIN, CURSOR_STROKE, GRID_STROKE, INTENT_COLOR, LINE_WIDTH, TICK, axisWidthFor, chartHeight, seriesColor } from '../theme'
import { LEGEND_ICON_SIZE, LEGEND_WRAPPER, legendLabel } from './legend'
import { useChartAnim } from './ChartFrame'
import { ReferenceFrame } from './ReferenceFrame'
import { referenceDash } from './references'
import { ClayTooltip } from './ClayTooltip'
import { maxSeriesValue, resolveCartesian } from './data'

type AreaSpecT = SpecOf<'area'>

export function AreaWidget({ spec, data, fill }: WidgetComponentProps<AreaSpecT>) {
  const anim = useChartAnim()
  const uid = useId() // namespace gradient ids so two area charts on a page don't collide
  const { rows, xKey, seriesKeys } = resolveCartesian(spec, data.rows)
  const multi = seriesKeys.length > 1
  const catFmt: Format = spec.xFormat ?? { kind: 'string' }
  const numFmt: Format = { kind: 'number', ...(spec.yFormat ?? {}), compact: true }
  const valWidth = axisWidthFor([String(formatValue(maxSeriesValue(rows, seriesKeys, spec.stacked), numFmt))])
  // stacked bands need a near-solid fill to stay legible; a single area keeps the deep editorial fade
  const fillStops = spec.stacked ? { top: 0.5, bottom: 0.32 } : { top: 0.18, bottom: 0 }

  return (
    <ReferenceFrame height={fill ? '100%' : chartHeight(spec)} references={spec.references} valueFormat={spec.yFormat}>
      <AreaChart data={rows} margin={CHART_MARGIN}>
        <defs>
          {seriesKeys.map((key, i) => {
            const c = seriesColor(i)
            return (
              <linearGradient id={`${uid}-area-${i}`} key={key} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={fillStops.top} />
                <stop offset="100%" stopColor={c} stopOpacity={fillStops.bottom} />
              </linearGradient>
            )
          })}
        </defs>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: AXIS_STROKE }}
          tickFormatter={(v: unknown) => formatTick(v, catFmt)}
          interval="preserveStartEnd"
          minTickGap={24}
          tickMargin={6}
        />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={valWidth} tickMargin={4} tickFormatter={(v: number) => formatValue(v, numFmt)} />
        <Tooltip cursor={{ stroke: CURSOR_STROKE, strokeWidth: 1 }} content={<ClayTooltip labelFmt={catFmt} valueFmt={spec.yFormat} hideName={!multi} />} />
        {multi && <Legend verticalAlign="top" align="left" wrapperStyle={LEGEND_WRAPPER} iconType="circle" iconSize={LEGEND_ICON_SIZE} formatter={legendLabel} itemSorter={null} />}
        {seriesKeys.map((key, i) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            name={key}
            stackId={spec.stacked ? 'a' : undefined}
            stroke={seriesColor(i)}
            strokeWidth={LINE_WIDTH}
            strokeLinejoin="round"
            fill={`url(#${uid}-area-${i})`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--paper-2)' }}
            fillOpacity={1}
            isAnimationActive={anim.isAnimationActive}
            animationDuration={anim.animationDuration}
          />
        ))}
        {spec.references?.map((ref, i) => {
          const color = INTENT_COLOR[ref.intent] ?? INTENT_COLOR.neutral
          return (
            <ReferenceLine
              key={`ref-${i}`}
              y={ref.value}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray={referenceDash(i)}
              ifOverflow="extendDomain"
            />
          )
        })}
      </AreaChart>
    </ReferenceFrame>
  )
}
