/**
 * Showcase board fixtures — 데일리카트 (e-commerce) sample data driving REAL
 * <WidgetRenderer> instances on the landing page. Each entry is a bare ChartSpec +
 * a WidgetData ({columns, rows}) shaped EXACTLY like execute_sql's payload, plus the
 * "유래 질문" (the natural-language ask that produced this widget) to show ask→board
 * causality. Same contract as src/lib/viz/spec.ts — nothing here is landing-specific
 * beyond the copy, so the widgets render identically to /app/dashboards.
 *
 * All user-facing copy (widget titles, table labels, and the region/category/product
 * VALUES that render on axes, legends and table rows) is injected from the localized
 * `showcase` message namespace via `buildBoardWidgets(labels)` — the component reads
 * the strings with next-intl and passes them here. Only non-text structure (numbers,
 * spec types, formats, column keys) lives in this module.
 */
import type { ChartSpec, WidgetData } from '@/lib/viz/spec'

const krw = { kind: 'currency' as const, currency: 'KRW', compact: true }

/** Per-widget operator status rendered under the card (approved-KPI board). */
export interface BoardStatus {
  /** the definition was execution-verified before it was approved */
  verified: boolean
  /** 'normal' | 'anomaly' = a monitor exists; 'none' = dashboard-only KPI */
  monitoring: 'normal' | 'anomaly' | 'none'
  /** minutes since the monitor last checked (omit for dashboard-only) */
  checkedMin?: number
}

export interface BoardWidget {
  key: string
  /** the natural-language question that produced this widget (not rendered) */
  ask: string
  /** column span on the 12-col board grid (desktop) */
  col: number
  spec: ChartSpec
  data: WidgetData
  status: BoardStatus
}

/** Localized copy injected by the component (read from the `showcase` namespace). */
export interface BoardLabels {
  titles: {
    revenue: string
    orders: string
    revenueTrend: string
    topProducts: string
    regionCategory: string
  }
  vsYesterday: string
  orderUnit: string
  tableCols: { product: string; revenue: string; orders: string }
  /** 5 region names, order fixed (Seoul, Gyeonggi, Busan, Daegu, Incheon). */
  regions: string[]
  /** 3 category names, order fixed (fresh food, packaged food, household). */
  categories: string[]
  /** 5 product names, order fixed to match the row revenues below. */
  products: string[]
}

// 14-day daily revenue (₩), gently trending up with weekend dips
const days = Array.from({ length: 14 }, (_, i) => {
  const weekend = i % 7 === 5 || i % 7 === 6
  const base = 3_400_000 + i * 62_000 + Math.round(Math.sin(i / 1.7) * 260_000)
  return { day: `06-${String(i + 1).padStart(2, '0')}`, revenue: weekend ? base - 520_000 : base }
})

// 지역 × 카테고리 매출 — weights per category (index-aligned to labels.categories)
const catWeights = [1, 0.62, 0.44]
const regionBase = [24_800_000, 19_400_000, 11_200_000, 8_600_000, 7_300_000]

// per-product revenue/orders (index-aligned to labels.products)
const productStats = [
  { revenue: 4_180_000, orders: 612 },
  { revenue: 3_240_000, orders: 540 },
  { revenue: 2_910_000, orders: 188 },
  { revenue: 1_760_000, orders: 470 },
  { revenue: 1_320_000, orders: 388 },
]

export function buildBoardWidgets(labels: BoardLabels): BoardWidget[] {
  const regionCategory = labels.regions.flatMap((region, i) =>
    labels.categories.map((category, j) => ({
      region,
      category,
      amount: Math.round(regionBase[i] * catWeights[j]),
    })),
  )

  return [
    {
      key: 'kpi-revenue',
      ask: '오늘 매출 어제보다 늘었어?',
      col: 3,
      spec: {
        type: 'kpi',
        title: labels.titles.revenue,
        value: 'today',
        format: krw,
        comparison: { value: 'yesterday', mode: 'percent', goodDirection: 'up' },
        description: labels.vsYesterday,
      },
      data: { columns: ['today', 'yesterday'], rows: [{ today: 4_240_000, yesterday: 3_772_000 }] },
      status: { verified: true, monitoring: 'normal', checkedMin: 2 },
    },
    {
      key: 'kpi-orders',
      ask: '오늘 주문 몇 건이야?',
      col: 3,
      spec: {
        type: 'kpi',
        title: labels.titles.orders,
        value: 'orders',
        format: { kind: 'number', unit: labels.orderUnit },
        comparison: { value: 'prev_orders', mode: 'percent', goodDirection: 'up' },
        description: labels.vsYesterday,
      },
      data: { columns: ['orders', 'prev_orders'], rows: [{ orders: 1284, prev_orders: 1189 }] },
      status: { verified: true, monitoring: 'anomaly', checkedMin: 2 },
    },
    {
      key: 'line-revenue',
      ask: '최근 2주 매출 추이 보여줘',
      col: 6,
      spec: {
        type: 'line',
        title: labels.titles.revenueTrend,
        x: 'day',
        y: 'revenue',
        curve: 'smooth',
        yFormat: krw,
        xFormat: { kind: 'string' },
      },
      data: { columns: ['day', 'revenue'], rows: days },
      status: { verified: true, monitoring: 'normal', checkedMin: 2 },
    },
    {
      key: 'table-products',
      ask: '가장 많이 팔린 상품은?',
      col: 4,
      spec: {
        type: 'table',
        title: labels.titles.topProducts,
        columns: [
          { key: 'name', label: labels.tableCols.product },
          { key: 'revenue', label: labels.tableCols.revenue, format: krw, align: 'right' },
          { key: 'orders', label: labels.tableCols.orders, format: { kind: 'number' }, align: 'right' },
        ],
        sort: { by: 'revenue', dir: 'desc' },
      },
      data: {
        columns: ['name', 'revenue', 'orders'],
        rows: labels.products.map((name, i) => ({ name, ...productStats[i] })),
      },
      status: { verified: true, monitoring: 'none' },
    },
    {
      key: 'stacked-region',
      ask: '이번 달 지역별 매출',
      col: 8,
      spec: {
        type: 'stackedBar',
        title: labels.titles.regionCategory,
        x: 'region',
        y: 'amount',
        series: 'category',
        orientation: 'vertical',
        yFormat: krw,
        colorIntent: 'categorical',
      },
      data: { columns: ['region', 'category', 'amount'], rows: regionCategory },
      status: { verified: true, monitoring: 'normal', checkedMin: 7 },
    },
  ]
}
