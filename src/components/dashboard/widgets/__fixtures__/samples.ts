/**
 * Sample (spec, data) pairs for the /dev gallery and tests. Each entry feeds the
 * WidgetRenderer exactly as a live agent answer would: a ChartSpec + a WidgetData
 * ({columns, rows}) shaped like execute_sql's payload. Covers all 12 types plus a
 * few edge variants (empty / truncated / many categories).
 */
import type { ChartSpec, WidgetData } from '@/lib/viz/spec'

export type SampleGroup = 'KPI · 숫자' | '막대' | '선 · 영역' | '비율' | '관계' | '표'

export interface WidgetSample {
  key: string
  label: string
  group: SampleGroup
  span?: 1 | 2
  spec: ChartSpec
  data: WidgetData
}

const months = ['1월', '2월', '3월', '4월', '5월', '6월']
const monthlyRevenue = [98, 108, 88, 126, 118, 141].map((v, i) => ({ month: months[i], revenue: v * 1_000_000 }))

const days14 = Array.from({ length: 14 }, (_, i) => {
  const base = 60 + Math.round(Math.sin(i / 2) * 14) + i * 3
  return { day: `06-${String(i + 1).padStart(2, '0')}`, signups: base, app: Math.round(base * 0.45), web: Math.round(base * 0.55) }
})

// long-format MRR by plan (for stacked / grouped bar pivot)
const mrrByPlan = months.flatMap((month, i) => [
  { month, plan: 'Pro', mrr: (12 + i * 1.5) * 1_000_000 },
  { month, plan: 'Team', mrr: (7 + i) * 1_000_000 },
  { month, plan: 'Free', mrr: (2 + i * 0.3) * 1_000_000 },
])

const categories = [
  { category: '전자기기', amount: 53_600_000 },
  { category: '패션', amount: 38_100_000 },
  { category: '식품', amount: 26_800_000 },
  { category: '뷰티', amount: 14_300_000 },
  { category: '기타', amount: 8_400_000 },
]

const adChannels = [
  { channel: 'Search', spend: 4_200_000, revenue: 18_400_000, clicks: 3200 },
  { channel: 'Search', spend: 2_800_000, revenue: 11_900_000, clicks: 2100 },
  { channel: 'Social', spend: 5_600_000, revenue: 16_200_000, clicks: 5400 },
  { channel: 'Social', spend: 3_100_000, revenue: 7_800_000, clicks: 3900 },
  { channel: 'Display', spend: 1_900_000, revenue: 4_100_000, clicks: 4200 },
  { channel: 'Display', spend: 1_200_000, revenue: 2_300_000, clicks: 2600 },
]

const topProducts = [
  { name: '무선 이어버드 Pro', revenue: 18_400_000, orders: 612, growth: 0.24 },
  { name: '스마트워치 7', revenue: 14_100_000, orders: 470, growth: 0.11 },
  { name: '기계식 키보드', revenue: 9_700_000, orders: 388, growth: -0.03 },
  { name: 'USB-C 허브', revenue: 7_200_000, orders: 540, growth: 0.06 },
  { name: '4K 웹캠', revenue: 5_900_000, orders: 295, growth: 0.18 },
]

const krw = { kind: 'currency' as const, currency: 'KRW', compact: true }

export const SAMPLES: WidgetSample[] = [
  // ── KPI · 숫자 ────────────────────────────────────────────────────────
  {
    key: 'kpi',
    label: 'KPI · 비교 델타',
    group: 'KPI · 숫자',
    spec: {
      type: 'kpi',
      title: '총 매출 (30일)',
      value: 'total_revenue',
      format: { kind: 'currency', currency: 'KRW', compact: true },
      comparison: { value: 'prev_revenue', mode: 'percent', goodDirection: 'up' },
      description: '지난 30일 대비',
    },
    data: { columns: ['total_revenue', 'prev_revenue'], rows: [{ total_revenue: 141_200_000, prev_revenue: 123_300_000 }] },
  },
  {
    key: 'bignumber',
    label: 'Big Number',
    group: 'KPI · 숫자',
    spec: { type: 'bignumber', title: '활성 사용자', value: 'active_users', caption: '지난 7일 기준', format: { kind: 'compact' } },
    data: { columns: ['active_users'], rows: [{ active_users: 8420 }] },
  },

  // ── 막대 ─────────────────────────────────────────────────────────────
  {
    key: 'bar',
    label: '막대 (단일)',
    group: '막대',
    spec: { type: 'bar', title: '월별 매출 추이', x: 'month', y: 'revenue', orientation: 'vertical', yFormat: krw, xFormat: { kind: 'string' } },
    data: { columns: ['month', 'revenue'], rows: monthlyRevenue },
  },
  {
    key: 'bar-h',
    label: '막대 (가로)',
    group: '막대',
    spec: { type: 'bar', title: '지역별 매출', x: 'region', y: 'revenue', orientation: 'horizontal', yFormat: krw, sort: { by: 'revenue', dir: 'desc' } },
    data: {
      columns: ['region', 'revenue'],
      rows: [
        { region: '서울', revenue: 48_200_000 },
        { region: '경기', revenue: 36_600_000 },
        { region: '부산', revenue: 25_100_000 },
        { region: '대구', revenue: 18_300_000 },
        { region: '기타', revenue: 13_000_000 },
      ],
    },
  },
  {
    key: 'stackedBar',
    label: '누적 막대 (long→wide)',
    group: '막대',
    span: 2,
    spec: { type: 'stackedBar', title: '플랜별 MRR', x: 'month', y: 'mrr', series: 'plan', orientation: 'vertical', yFormat: krw, colorIntent: 'categorical' },
    data: { columns: ['month', 'plan', 'mrr'], rows: mrrByPlan },
  },
  {
    key: 'groupedBar',
    label: '그룹 막대',
    group: '막대',
    span: 2,
    spec: { type: 'groupedBar', title: '플랜별 MRR (그룹)', x: 'month', y: 'mrr', series: 'plan', orientation: 'vertical', yFormat: krw },
    data: { columns: ['month', 'plan', 'mrr'], rows: mrrByPlan },
  },

  // ── 선 · 영역 ──────────────────────────────────────────────────────────
  {
    key: 'line',
    label: '선 (단일, smooth)',
    group: '선 · 영역',
    spec: { type: 'line', title: '일별 신규 가입 · 14일', x: 'day', y: 'signups', curve: 'smooth', yFormat: { kind: 'number', compact: true }, xFormat: { kind: 'string' } },
    data: { columns: ['day', 'signups'], rows: days14.map(({ day, signups }) => ({ day, signups })) },
  },
  {
    key: 'multiLine',
    label: '다중 선 (wide)',
    group: '선 · 영역',
    span: 2,
    spec: { type: 'multiLine', title: '채널별 가입 (웹 vs 앱)', x: 'day', y: ['web', 'app'], curve: 'linear', yFormat: { kind: 'number', compact: true } },
    data: { columns: ['day', 'web', 'app'], rows: days14.map(({ day, web, app }) => ({ day, web, app })) },
  },
  {
    key: 'area',
    label: '영역',
    group: '선 · 영역',
    span: 2,
    spec: { type: 'area', title: '월별 매출 (영역)', x: 'month', y: 'revenue', stacked: false, yFormat: krw },
    data: { columns: ['month', 'revenue'], rows: monthlyRevenue },
  },

  // ── 비율 ─────────────────────────────────────────────────────────────
  {
    key: 'donut',
    label: '도넛 + 중앙 라벨',
    group: '비율',
    spec: { type: 'donut', title: '카테고리 분포', category: 'category', value: 'amount', valueFormat: krw, centerLabel: '₩141M' },
    data: { columns: ['category', 'amount'], rows: categories },
  },
  {
    key: 'pie',
    label: '파이',
    group: '비율',
    spec: { type: 'pie', title: '카테고리 분포 (파이)', category: 'category', value: 'amount', valueFormat: krw },
    data: { columns: ['category', 'amount'], rows: categories },
  },

  // ── 관계 ─────────────────────────────────────────────────────────────
  {
    key: 'scatter',
    label: '산점도 (size + series)',
    group: '관계',
    span: 2,
    spec: { type: 'scatter', title: '광고비 vs 매출', x: 'spend', y: 'revenue', size: 'clicks', series: 'channel', xFormat: krw, yFormat: krw },
    data: { columns: ['channel', 'spend', 'revenue', 'clicks'], rows: adChannels },
  },

  // ── 표 ───────────────────────────────────────────────────────────────
  {
    key: 'table',
    label: '표 (포맷 + 정렬)',
    group: '표',
    span: 2,
    spec: {
      type: 'table',
      title: '상위 상품',
      columns: [
        { key: 'name', label: '상품' },
        { key: 'revenue', label: '매출', format: krw, align: 'right' },
        { key: 'orders', label: '주문', format: { kind: 'number' }, align: 'right' },
        { key: 'growth', label: '성장률', format: { kind: 'percent' }, align: 'right' },
      ],
      sort: { by: 'revenue', dir: 'desc' },
    },
    data: { columns: ['name', 'revenue', 'orders', 'growth'], rows: topProducts },
  },

  // ── edge variants ─────────────────────────────────────────────────────
  {
    key: 'edge-empty',
    label: 'Edge · 데이터 없음',
    group: '표',
    spec: { type: 'bar', title: '빈 결과', x: 'month', y: 'revenue', orientation: 'vertical' },
    data: { columns: ['month', 'revenue'], rows: [] },
  },
  {
    key: 'edge-truncated',
    label: 'Edge · 잘린 결과',
    group: '표',
    span: 2,
    spec: {
      type: 'table',
      title: '잘린 결과 (truncated)',
      columns: [
        { key: 'name', label: '상품' },
        { key: 'revenue', label: '매출', format: krw, align: 'right' },
      ],
    },
    data: { columns: ['name', 'revenue'], rows: topProducts, truncated: true },
  },
]

export const GROUPS: SampleGroup[] = ['KPI · 숫자', '막대', '선 · 영역', '비율', '관계', '표']

export const byKey = (key: string): WidgetSample | undefined => SAMPLES.find((s) => s.key === key)
