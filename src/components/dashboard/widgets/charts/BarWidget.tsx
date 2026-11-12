'use client'

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { formatTick, formatValue } from '@/lib/viz/format'
import type { Format } from '@/lib/viz/spec'
import type { SpecOf, WidgetComponentProps } from '../types'
import { AXIS_STROKE, BAR_MAX_SIZE, BAR_RADIUS, CHART_MARGIN, CURSOR_FILL, GRID_STROKE, INTENT_COLOR, TICK, axisWidthFor, chartHeight, seriesColor } from '../theme'
import { LEGEND_ICON_SIZE, LEGEND_WRAPPER, legendLabel } from './legend'
import { useChartAnim } from './ChartFrame'
import { ReferenceFrame } from './ReferenceFrame'
import { referenceDash } from './references'
import { ClayTooltip } from './ClayTooltip'
import { maxSeriesValue, resolveCartesian } from './data'

type BarSpecT = SpecOf<'bar' | 'stackedBar' | 'groupedBar'>

export function BarWidget({ spec, data, fill }: WidgetComponentProps<BarSpecT>) {
  const anim = useChartAnim()
  const { rows, xKey, seriesKeys } = resolveCartesian(spec, data.rows)
  const horizontal = spec.orientation === 'horizontal'
  const stacked = spec.type === 'stackedBar'
  const multi = seriesKeys.length > 1

  const catFmt: Format = spec.xFormat ?? { kind: 'string' }
  const numFmt: Format = { kind: 'number', ...(spec.yFormat ?? {}), compact: true }

  // Near-zero values in a wide-domain chart render as sub-pixel slivers (e.g. 1-2 against an
  // 80 axis) — keep them visible with a 3px floor. True zeros stay invisible (a floor would
  // fake data), and stacked bars are exempt (inflated segments misstate the stack total).
  const minPointSize = stacked ? undefined : (v: unknown) => (v == null || Number(v) === 0 ? 0 : 3)

  // Category axis policy splits on WHAT the categories are:
  // - nominal categories (names): label EVERY one (preserveStartEnd silently drops middles —
  //   an unlabeled product bar is unreadable) and angle when many/long so none are clipped.
  // - DATE categories (a time series that happens to render as bars): thinning is standard —
  //   use Recharts' width-aware preserveStartEnd with short year-less ticks (formatTick), never
  //   angled. Full dates × every tick × -35° used to swamp small cells entirely (ko/ja worst;
  //   the tooltip keeps the full date).
  const isDateAxis = catFmt.kind === 'date'
  const catLabels = rows.map((r) => String(formatTick(r[xKey], catFmt)))
  const denseX = !horizontal && !isDateAxis && (catLabels.length > 8 || catLabels.some((c) => c.length > 6))

  // size the value axis to its widest formatted tick, and the (horizontal) category axis to its labels
  const valWidth = axisWidthFor([String(formatValue(maxSeriesValue(rows, seriesKeys, stacked), numFmt))])
  const catWidth = axisWidthFor(catLabels, 56, 140)

  // bottom (X) axis: value when horizontal, category when vertical
  const xAxisEl = (
    <XAxis
      type={horizontal ? 'number' : 'category'}
      dataKey={horizontal ? undefined : xKey}
      tickFormatter={horizontal ? (v: number) => formatValue(v, numFmt) : (v: unknown) => formatTick(v, catFmt)}
      tick={TICK}
      tickLine={false}
      axisLine={{ stroke: AXIS_STROKE }}
      interval={horizontal || isDateAxis ? 'preserveStartEnd' : 0}
      tickMargin={denseX ? 8 : 6}
      {...(denseX ? { angle: -35, textAnchor: 'end' as const, height: 54 } : {})}
    />
  )
  // left (Y) axis: category when horizontal, value when vertical
  const yAxisEl = (
    <YAxis
      type={horizontal ? 'category' : 'number'}
      dataKey={horizontal ? xKey : undefined}
      tickFormatter={horizontal ? (v: unknown) => formatTick(v, catFmt) : (v: number) => formatValue(v, numFmt)}
      tick={TICK}
      tickLine={false}
      axisLine={false}
      width={horizontal ? catWidth : valWidth}
      interval={horizontal ? 0 : undefined}
      tickMargin={4}
    />
  )

  // horizontal bars grow with row count so labels never collapse; vertical uses the
  // shared reserve (+room when labels are angled)
  const frameHeight: number | `${number}%` = fill
    ? '100%'
    : horizontal
      ? Math.min(560, Math.max(180, rows.length * (multi ? 30 : 36) + 64))
      : chartHeight(spec) + (denseX ? 32 : 0)

  return (
    <ReferenceFrame height={frameHeight} references={spec.references} valueFormat={spec.yFormat}>
      <BarChart
        data={rows}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ ...CHART_MARGIN, ...(denseX ? { bottom: 24 } : {}) }}
        barCategoryGap={horizontal ? '26%' : '24%'}
        barGap={2}
      >
        <CartesianGrid stroke={GRID_STROKE} horizontal={!horizontal} vertical={horizontal} />
        {xAxisEl}
        {yAxisEl}
        <Tooltip
          cursor={{ fill: CURSOR_FILL }}
          content={<ClayTooltip labelFmt={catFmt} valueFmt={spec.yFormat} hideName={!multi} />}
        />
        {multi && <Legend verticalAlign="top" align="left" wrapperStyle={LEGEND_WRAPPER} iconType="circle" iconSize={LEGEND_ICON_SIZE} formatter={legendLabel} itemSorter={null} />}
        {seriesKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            name={key}
            stackId={stacked ? 'a' : undefined}
            fill={seriesColor(i)}
            radius={stacked ? 0 : horizontal ? [0, BAR_RADIUS, BAR_RADIUS, 0] : [BAR_RADIUS, BAR_RADIUS, 0, 0]}
            isAnimationActive={anim.isAnimationActive}
            animationDuration={anim.animationDuration}
            maxBarSize={BAR_MAX_SIZE}
            minPointSize={minPointSize}
          />
        ))}
        {spec.references?.map((ref, i) => {
          const color = INTENT_COLOR[ref.intent] ?? INTENT_COLOR.neutral
          const props = horizontal ? { x: ref.value } : { y: ref.value }
          return (
            <ReferenceLine
              key={`ref-${i}`}
              {...props}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray={referenceDash(i)}
              ifOverflow="extendDomain"
            />
          )
        })}
      </BarChart>
    </ReferenceFrame>
  )
}
