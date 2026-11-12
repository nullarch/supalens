/**
 * Sample dashboard widgets — the demo data shown on /app/dashboards when no real
 * dashboard is persisted yet (Supabase unconfigured in local dev, or an empty org).
 * Rendered through the same widget library + grid as real, agent-authored widgets.
 */
import type { GridWidget } from '@/components/dashboard/widgets/DashboardGrid'

export const SAMPLE_OVERVIEW_WIDGETS: GridWidget[] = [
  {
    id: 'monthly-revenue',
    w: 12,
    h: 4,
    spec: {
      type: 'bar',
      title: '월별 매출 추이',
      x: 'month',
      y: 'revenue',
      orientation: 'vertical',
      xFormat: { kind: 'string' },
      yFormat: { kind: 'currency', currency: 'KRW', compact: true },
    },
    data: {
      columns: ['month', 'revenue'],
      rows: [
        { month: '1월', revenue: 98_000_000 },
        { month: '2월', revenue: 108_000_000 },
        { month: '3월', revenue: 88_000_000 },
        { month: '4월', revenue: 126_000_000 },
        { month: '5월', revenue: 118_000_000 },
        { month: '6월', revenue: 141_000_000 },
      ],
    },
  },
  {
    id: 'region-revenue',
    w: 6,
    h: 4,
    spec: {
      type: 'bar',
      title: '지역별 매출',
      x: 'region',
      y: 'revenue',
      orientation: 'horizontal',
      yFormat: { kind: 'currency', currency: 'KRW', compact: true },
      sort: { by: 'revenue', dir: 'desc' },
    },
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
    id: 'category-mix',
    w: 6,
    h: 4,
    spec: {
      type: 'donut',
      title: '카테고리 분포',
      category: 'category',
      value: 'revenue',
      valueFormat: { kind: 'currency', currency: 'KRW', compact: true },
    },
    data: {
      columns: ['category', 'revenue'],
      rows: [
        { category: '전자기기', revenue: 53_600_000 },
        { category: '패션', revenue: 38_100_000 },
        { category: '식품', revenue: 26_800_000 },
        { category: '기타', revenue: 22_700_000 },
      ],
    },
  },
  {
    id: 'daily-signups',
    w: 6,
    h: 4,
    spec: {
      type: 'area',
      title: '일별 신규 가입 · 14일',
      x: 'date',
      y: 'signups',
      stacked: false,
      xFormat: { kind: 'string' },
      yFormat: { kind: 'number' },
    },
    data: {
      columns: ['date', 'signups'],
      rows: [
        { date: '6/17', signups: 62 },
        { date: '6/18', signups: 68 },
        { date: '6/19', signups: 64 },
        { date: '6/20', signups: 79 },
        { date: '6/21', signups: 74 },
        { date: '6/22', signups: 88 },
        { date: '6/23', signups: 83 },
        { date: '6/24', signups: 97 },
        { date: '6/25', signups: 92 },
        { date: '6/26', signups: 105 },
        { date: '6/27', signups: 99 },
        { date: '6/28', signups: 112 },
        { date: '6/29', signups: 108 },
        { date: '6/30', signups: 124 },
      ],
    },
  },
  {
    id: 'top-products',
    w: 6,
    h: 5,
    spec: {
      type: 'table',
      title: '상위 상품',
      columns: [
        { key: 'product', label: '상품' },
        { key: 'revenue', label: '매출', format: { kind: 'currency', currency: 'KRW', compact: true }, align: 'right' },
        { key: 'orders', label: '주문', format: { kind: 'number' }, align: 'right' },
        { key: 'growth', label: '성장률', format: { kind: 'percent' }, align: 'right' },
      ],
    },
    data: {
      columns: ['product', 'revenue', 'orders', 'growth'],
      rows: [
        { product: '무선 이어버드 Pro', revenue: 18_400_000, orders: 612, growth: 0.24 },
        { product: '스마트워치 7', revenue: 14_100_000, orders: 470, growth: 0.11 },
        { product: '기계식 키보드', revenue: 9_700_000, orders: 388, growth: -0.03 },
        { product: 'USB-C 허브', revenue: 7_200_000, orders: 540, growth: 0.06 },
        { product: '4K 웹캠', revenue: 5_900_000, orders: 295, growth: 0.18 },
      ],
    },
  },
]
