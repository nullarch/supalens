'use client'

import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ChartSpec, migrateSpec, referencedColumns, WidgetDataSchema } from '@/lib/viz/spec'
import type { WidgetData } from '@/lib/viz/spec'
import type { WidgetSource } from '@/lib/dashboards/widget-source'
import { setVizLocale } from '@/lib/viz/format'
import { Widget } from './Widget'
import { CHART_TYPES, WIDGET_REGISTRY } from './registry'
import { chartHeight } from './theme'
import { chartDataIssue } from './presentation'

export interface WidgetRendererProps {
  /** a VisualizationSpec envelope OR a bare ChartSpec (unknown → validated here) */
  spec: unknown
  /** the query result; if omitted, the envelope's `sample` is used */
  data?: unknown
  /** caller-driven states (query in flight / failed) — overrides data-derived state */
  state?: 'loading' | 'error'
  error?: string
  refreshedAt?: string | Date | null
  span?: 1 | 2
  /** override the ⋯ menu; pass null to hide it */
  menu?: ReactNode
  /** fill the host's height (dashboard grid cell) instead of a fixed px reserve */
  fill?: boolean
  /** monitoring strip pinned under the body (report boards only) */
  footer?: ReactNode
  /** the service this widget reads from, named above the title (dashboard boards only) */
  source?: WidgetSource | null
}

export function WidgetRenderer({ spec, data, state, error, refreshedAt, span, menu, fill, footer, source }: WidgetRendererProps) {
  const t = useTranslations('appDashboards')
  // number/date formatting follows the app locale (formatValue is deep inside the chart tree,
  // so the locale travels via the viz module singleton rather than through every prop chain)
  setVizLocale(useLocale())
  // accept either the full envelope or a bare chart config. migrateSpec is THE envelope entry
  // point: every read path (dashboards, run history, shares, KPI previews) funnels through this
  // component, so version upcasts land here once instead of at N call sites.
  const env = migrateSpec(spec)
  const chartParse = env ? { success: true as const, data: env.chart } : ChartSpec.safeParse(spec)
  const sample = env?.sample

  if (!chartParse.success) {
    return (
      <Widget title={t('widget.invalidTitle')} state="error" error={t('widget.invalidSpec')} span={span} menu={menu} fill={fill} footer={footer} source={source}>
        {null}
      </Widget>
    )
  }
  const chart = chartParse.data
  const isChart = CHART_TYPES.has(chart.type)
  // ONE source of truth for the reserved body height — same value across loading /
  // empty / ready so the lazy chart chunk swaps in with no layout shift (CLS).
  const bodyHeight = isChart ? chartHeight(chart) : chart.type === 'table' ? undefined : 132

  // caller-forced loading / error short-circuit the body
  if (state === 'loading') {
    return <Widget title={chart.title} description={chart.description} state="loading" span={span} bodyHeight={bodyHeight} flush={isChart} fill={fill} refreshedAt={refreshedAt} menu={menu} footer={footer} source={source} />
  }
  if (state === 'error' || error) {
    return <Widget title={chart.title} description={chart.description} state="error" error={error} span={span} bodyHeight={bodyHeight} flush={isChart} fill={fill} menu={menu} footer={footer} source={source} />
  }

  const parsed = WidgetDataSchema.safeParse(data ?? sample)
  const widgetData: WidgetData | null = parsed.success ? parsed.data : null
  if (!widgetData) {
    return <Widget title={chart.title} description={chart.description} state="error" error={t('widget.invalidData')} span={span} bodyHeight={bodyHeight} flush={isChart} fill={fill} menu={menu} footer={footer} source={source} />
  }
  const empty = widgetData.rows.length === 0

  if (empty) {
    return <Widget title={chart.title} description={chart.description} state="empty" span={span} bodyHeight={bodyHeight} flush={isChart} fill={fill} refreshedAt={refreshedAt} menu={menu} footer={footer} source={source} />
  }

  // schema drift: a re-run whose columns no longer match the encodings must be a VISIBLE error,
  // not a plausible-looking chart of undefined values ('—' cells / empty axes)
  const missing = referencedColumns(chart).filter((c) => !widgetData!.columns.includes(c))
  if (missing.length > 0) {
    return (
      <Widget
        title={chart.title}
        description={chart.description}
        state="error"
        error={t('widget.missingColumns', { columns: missing.join(', ') })}
        span={span}
        bodyHeight={bodyHeight}
        flush={isChart}
        fill={fill}
        menu={menu}
        footer={footer} source={source}
      />
    )
  }

  const Comp = WIDGET_REGISTRY[chart.type]
  const issue = isChart ? chartDataIssue(chart, widgetData) : null
  return (
    <Widget
      title={chart.title}
      description={chart.description}
      refreshedAt={refreshedAt}
      span={span}
      menu={menu}
      truncated={widgetData!.truncated}
      bodyHeight={bodyHeight}
      flush={isChart}
      fill={fill}
      footer={footer} source={source}
      state="ready"
    >
      {issue ? <div role="status" style={{ padding: '16px 6px 16px 10px', maxWidth: '56ch', fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>{t(`widget.${issue}`)}</div> : <Comp spec={chart} data={widgetData} fill={fill} />}
    </Widget>
  )
}
