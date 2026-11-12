/* ============================================================
   Static sample data for the /test/app design prototype.
   Plausible Korean e-commerce analytics numbers — clearly a MOCK
   (no fetching, no state). Kept in one place so the three screens
   read from the same fictional "이커머스 DB".
   ============================================================ */

export type BarDatum = { label: string; value: number; display: string; highlight?: boolean }
export type Segment = { label: string; pct: number; display: string; highlight?: boolean }
export type Series = { name: string; points: number[]; highlight?: boolean }

/* ---------------- 질문하기 (ask) ---------------- */

export const DATA_SOURCE_TAG = '이커머스 DB · postgres'

export const RECENT_QUESTIONS: string[] = [
  '지난주 대비 이번주 주문 수 변화는?',
  '이탈 위험이 높은 고객 세그먼트는?',
  '카테고리별 재고 회전율 알려줘',
]

export const ASK_QUESTION = '이번 달 매출을 지역별로 보여줘'

// SQL echo, tokenised so keywords render at full ink and the rest at --cx-text-sec.
// `>=` lives inside a token string (rendered via {tok.t}), never as JSX text.
export const ASK_SQL: { t: string; k?: boolean }[][] = [
  [
    { t: 'SELECT', k: true },
    { t: ' region, ' },
    { t: 'SUM', k: true },
    { t: '(amount) ' },
    { t: 'AS', k: true },
    { t: ' revenue, ' },
    { t: 'COUNT', k: true },
    { t: '(*) ' },
    { t: 'AS', k: true },
    { t: ' orders' },
  ],
  [{ t: 'FROM', k: true }, { t: ' orders' }],
  [
    { t: 'WHERE', k: true },
    { t: ' created_at >= ' },
    { t: 'date_trunc', k: true },
    { t: "('month', " },
    { t: 'now', k: true },
    { t: '())' },
  ],
  [
    { t: 'GROUP BY', k: true },
    { t: ' region ' },
    { t: 'ORDER BY', k: true },
    { t: ' revenue ' },
    { t: 'DESC', k: true },
  ],
]

// Result table + the horizontal bar chart share these rows (서울 = the single clay highlight).
export const ASK_ROWS: { region: string; revenue: number; revenueDisplay: string; orders: string }[] = [
  { region: '서울', revenue: 8240, revenueDisplay: '₩8,240만', orders: '3,180' },
  { region: '경기', revenue: 5120, revenueDisplay: '₩5,120만', orders: '2,040' },
  { region: '부산', revenue: 2980, revenueDisplay: '₩2,980만', orders: '1,150' },
  { region: '대구', revenue: 1760, revenueDisplay: '₩1,760만', orders: '720' },
  { region: '인천', revenue: 1340, revenueDisplay: '₩1,340만', orders: '560' },
]

export const ASK_INSIGHT =
  '서울이 전체 매출의 약 41%를 차지하며, 상위 두 지역(서울·경기)이 절반을 넘습니다. 부산 이하 지역은 주문당 객단가는 비슷하나 주문 수 자체가 낮습니다.'

/* ---------------- 대시보드 (dashboards) ---------------- */

export type Kpi = { label: string; value: string; delta: string; trend: 'up' | 'down' }

export const KPIS: Kpi[] = [
  { label: '월 매출', value: '₩1.84억', delta: '+14.5% 지난달 대비', trend: 'up' },
  { label: '주문 수', value: '7,650', delta: '+8.2% 지난달 대비', trend: 'up' },
  { label: '평균 객단가', value: '₩24,050', delta: '−2.1% 지난달 대비', trend: 'down' },
]

// 월별 매출 (백만원) — 6 bars, the current month (6월) is the single clay highlight.
export const MONTHLY_REVENUE: BarDatum[] = [
  { label: '1월', value: 128, display: '1.28억' },
  { label: '2월', value: 142, display: '1.42억' },
  { label: '3월', value: 135, display: '1.35억' },
  { label: '4월', value: 158, display: '1.58억' },
  { label: '5월', value: 171, display: '1.71억' },
  { label: '6월', value: 184, display: '1.84억', highlight: true },
]

// 카테고리 분포 — ink-opacity segments + 1 clay highlight.
export const CATEGORY_MIX: Segment[] = [
  { label: '전자기기', pct: 41, display: '41%', highlight: true },
  { label: '패션', pct: 24, display: '24%' },
  { label: '뷰티', pct: 17, display: '17%' },
  { label: '리빙', pct: 11, display: '11%' },
  { label: '기타', pct: 7, display: '7%' },
]

export const CATEGORY_TOTAL = '₩1.84억'

// 주간 신규 가입 — 1 ink line + 1 clay line, 8 weeks.
export const SIGNUPS_SERIES: Series[] = [
  { name: '신규 가입', points: [120, 138, 129, 152, 146, 168, 176, 190] },
  { name: '유료 전환', points: [38, 46, 44, 58, 55, 70, 78, 92], highlight: true },
]

export const SIGNUPS_XLABELS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']

// 상위 상품 — 5 rows.
export const TOP_PRODUCTS: { name: string; revenue: string }[] = [
  { name: '무선 이어버드 Pro', revenue: '₩3,240만' },
  { name: '스마트워치 SE', revenue: '₩2,180만' },
  { name: '노트북 스탠드', revenue: '₩1,560만' },
  { name: '기계식 키보드', revenue: '₩1,320만' },
  { name: 'USB-C 멀티 허브', revenue: '₩980만' },
]

/* ---------------- 알림 (alerts) ---------------- */

export type Alert = {
  id: string
  name: string
  condition: string
  source: string
  lastChecked: string
  enabled: boolean
  status: 'normal' | 'firing'
  explanation?: string
}

export const ALERTS: Alert[] = [
  {
    id: 'a1',
    name: '일 매출 급락 감지',
    condition: 'daily_revenue < 0.7 × avg_7d',
    source: '이커머스 DB',
    lastChecked: '방금 전',
    enabled: true,
    status: 'firing',
    explanation:
      '오늘 일 매출(₩1,180만)이 최근 7일 평균의 68% 수준으로, 임계치 70%를 밑돌았습니다. 서울 지역 주문이 전일 대비 34% 감소한 것이 주된 원인으로 보이며, 오전 결제 실패율도 평소보다 높았습니다.',
  },
  {
    id: 'a2',
    name: '신규 가입 급감',
    condition: 'signups_today < 0.5 × avg_14d',
    source: '이커머스 DB',
    lastChecked: '3분 전',
    enabled: true,
    status: 'normal',
  },
  {
    id: 'a3',
    name: '재고 소진 경고',
    condition: 'min(stock_qty) < 10',
    source: '이커머스 DB',
    lastChecked: '8분 전',
    enabled: true,
    status: 'normal',
  },
  {
    id: 'a4',
    name: '결제 실패율 상승',
    condition: 'payment_fail_rate > 0.05',
    source: '이커머스 DB',
    lastChecked: '12분 전',
    enabled: true,
    status: 'normal',
  },
  {
    id: 'a5',
    name: '환불 금액 이상치',
    condition: 'refund_amount · z-score > 3',
    source: '이커머스 DB',
    lastChecked: '1시간 전',
    enabled: false,
    status: 'normal',
  },
]
