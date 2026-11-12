'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import type { ChartType } from '@/lib/viz/spec'
import { ChartSkeleton } from './charts/ChartSkeleton'
import { BigNumber } from './primitives/BigNumber'
import { DataTable } from './primitives/DataTable'
import { KpiStat } from './primitives/KpiStat'
import type { WidgetComponentProps } from './types'

type WidgetComp = ComponentType<WidgetComponentProps>

// Recharts widgets: client-only + lazy. ssr:false because ResponsiveContainer reads
// the DOM; the skeleton reserves height so there is no layout shift on hydrate.
const chart = (load: () => Promise<{ default: WidgetComp }>) =>
  dynamic(load, { ssr: false, loading: () => <ChartSkeleton /> })

const BarWidget = chart(() => import('./charts/BarWidget').then((m) => ({ default: m.BarWidget as WidgetComp })))
const LineWidget = chart(() => import('./charts/LineWidget').then((m) => ({ default: m.LineWidget as WidgetComp })))
const AreaWidget = chart(() => import('./charts/AreaWidget').then((m) => ({ default: m.AreaWidget as WidgetComp })))
const PieWidget = chart(() => import('./charts/PieWidget').then((m) => ({ default: m.PieWidget as WidgetComp })))
const ScatterWidget = chart(() => import('./charts/ScatterWidget').then((m) => ({ default: m.ScatterWidget as WidgetComp })))

/** spec.type → component. Several chart-type literals share one implementation. */
export const WIDGET_REGISTRY: Record<ChartType, WidgetComp> = {
  // pure tiles (static import, zero chart-lib code)
  kpi: KpiStat as WidgetComp,
  bignumber: BigNumber as WidgetComp,
  table: DataTable as WidgetComp,
  // recharts-backed (lazy)
  bar: BarWidget,
  stackedBar: BarWidget,
  groupedBar: BarWidget,
  line: LineWidget,
  multiLine: LineWidget,
  area: AreaWidget,
  pie: PieWidget,
  donut: PieWidget,
  scatter: ScatterWidget,
}

/** chart types that need a reserved body height + flush padding (vs. pure tiles). */
export const CHART_TYPES: ReadonlySet<ChartType> = new Set<ChartType>([
  'bar',
  'stackedBar',
  'groupedBar',
  'line',
  'multiLine',
  'area',
  'pie',
  'donut',
  'scatter',
])
