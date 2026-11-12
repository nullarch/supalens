'use client'

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
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

type LineSpecT = SpecOf<'line' | 'multiLine'>

const CURVE = { linear: 'linear', smooth: 'monotone', step: 'stepAfter' } as const

export function LineWidget({ spec, data, fill }: WidgetComponentProps<LineSpecT>) {
  const anim = useChartAnim()
  const { rows, xKey, seriesKeys } = resolveCartesian(spec, data.rows)
  const multi = seriesKeys.length > 1
  const catFmt: Format = spec.xFormat ?? { kind: 'string' }
  const numFmt: Format = { kind: 'number', ...(spec.yFormat ?? {}), compact: true }
  const curveType = CURVE[spec.curve]
  const valWidth = axisWidthFor([String(formatValue(maxSeriesValue(rows, seriesKeys), numFmt))])

  return (
    <ReferenceFrame height={fill ? '100%' : chartHeight(spec)} references={spec.references} valueFormat={spec.yFormat}>
      <LineChart data={rows} margin={CHART_MARGIN}>
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
          <Line
            key={key}
            type={curveType}
            dataKey={key}
            name={key}
            stroke={seriesColor(i)}
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--paper-2)' }}
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
      </LineChart>
    </ReferenceFrame>
  )
}
