/**
 * Auto-KPI template catalog (design: docs/auto-kpi-plan.md — "지표 리스트").
 *
 * The built-in menu of KPIs the extraction agent instantiates against a real schema.
 * It is (a) prompt-injected as the agent's vocabulary and (b) the tier-1 (DB-only) fallback
 * set. Each template describes a KPI in the abstract — the agent maps `requiredShapes` onto
 * the real tables/columns, writes + runs the SQL, and only then proposes it.
 *
 * Shared between the Next.js BFF and the Trigger.dev runtime — no 'server-only' and no
 * React/server imports (same rule as src/lib/kpi/types.ts and src/lib/viz/spec.ts).
 */
import type { KpiAlertConfig, KpiCategory } from '@/lib/kpi/types'
import type { ChartType } from '@/lib/viz/spec'

export interface KpiTemplate {
  /** stable snake_case English slug, e.g. 'daily_revenue' */
  key: string
  category: KpiCategory
  /** Korean, user-facing (e.g. '일 매출') */
  title: string
  /** Korean, one line */
  description: string
  /** English hint: the table/column shape this KPI needs to exist */
  requiredShapes: string
  /** English one-liner on how to compute it (NOT full SQL) */
  sqlHint?: string
  /** default chart — must be a valid ChartSpec discriminator */
  defaultChartType: ChartType
  /** suggested monitor when the metric reduces to a meaningful scalar/series */
  defaultAlert?: KpiAlertConfig
  /** 5 = north-star / core revenue, 4 = core health, 3 = useful */
  defaultImportance: 1 | 2 | 3 | 4 | 5
}

/**
 * The 22 built-in templates (growth 4 · revenue 8 · engagement 4 · ops 5 · funnel 1).
 * `custom` is intentionally NOT a template — service-specific KPIs are prompt-instructed at
 * tier-2 from code evidence, not enumerated here.
 */
export const KPI_TEMPLATES: KpiTemplate[] = [
  // ── growth ──────────────────────────────────────────────────────────────
  {
    key: 'new_signups',
    category: 'growth',
    title: '일 신규 가입',
    description: '날짜별 신규 가입 사용자 수 추이',
    requiredShapes: 'users table with a created_at timestamp',
    sqlHint: 'count of users grouped by date-truncated created_at over the last 90 days',
    defaultChartType: 'line',
    defaultAlert: { type: 'anomaly', sensitivity: 3 },
    defaultImportance: 5,
  },
  {
    key: 'dau_wau_mau',
    category: 'growth',
    title: '활성 사용자 (DAU/WAU/MAU)',
    description: '일·주·월 단위 활성 사용자 수',
    requiredShapes: 'an events/sessions table (or users.last_seen_at) marking activity per day',
    sqlHint: 'count distinct active user id per day (or week/month) from an activity table',
    defaultChartType: 'line',
    defaultAlert: { type: 'anomaly', sensitivity: 3 },
    defaultImportance: 5,
  },
  {
    key: 'activation_rate',
    category: 'growth',
    title: '활성화율 (가입→첫 핵심 액션, D7)',
    description: '가입 후 7일 내 첫 핵심 액션에 도달한 사용자 비율',
    requiredShapes: 'users joined to a first-core-action event by user id',
    sqlHint: 'share of users who performed the core action within 7 days of signup; return the current and prior cohort as two columns for the kpi comparison',
    defaultChartType: 'kpi',
    defaultImportance: 4,
  },
  {
    key: 'growth_rate_wow',
    category: 'growth',
    title: '주간 가입 성장률',
    description: '전주 대비 신규 가입 증감률 (WoW)',
    requiredShapes: 'users table with created_at (derives from new_signups)',
    sqlHint: 'this-week signups minus last-week as a signed percentage; return the delta so lt 0 = shrinking',
    defaultChartType: 'bignumber',
    defaultAlert: { type: 'threshold', operator: 'lt', threshold: 0 },
    defaultImportance: 4,
  },
  // ── revenue ─────────────────────────────────────────────────────────────
  {
    key: 'daily_revenue',
    category: 'revenue',
    title: '일 매출 / GMV',
    description: '날짜별 결제 완료 금액 합계',
    requiredShapes: 'orders/payments with amount, a paid/completed status, created_at',
    sqlHint: 'sum of paid/completed order amounts grouped by date over the last 90 days',
    defaultChartType: 'bar',
    defaultAlert: { type: 'anomaly', sensitivity: 3 },
    defaultImportance: 5,
  },
  {
    key: 'mrr',
    category: 'revenue',
    title: 'MRR (월 반복 매출)',
    description: '활성 구독 기준 월 반복 매출',
    requiredShapes: 'subscriptions with an active status and a monthly price/amount',
    sqlHint: 'sum of the monthly-normalized price across active subscriptions; also compute the value as of ~30 days ago as a second column for the kpi comparison',
    defaultChartType: 'kpi',
    defaultImportance: 5,
  },
  {
    key: 'arpu',
    category: 'revenue',
    title: 'ARPU (결제 유저당 평균 매출)',
    description: '결제 사용자 1인당 평균 매출',
    requiredShapes: 'order/payment amounts with a distinct paying-user id',
    sqlHint: 'total revenue divided by distinct paying users, current period vs previous period as two columns for the kpi comparison',
    defaultChartType: 'kpi',
    defaultImportance: 4,
  },
  {
    key: 'aov',
    category: 'revenue',
    title: 'AOV (평균 주문 금액)',
    description: '주문 1건당 평균 결제 금액',
    requiredShapes: 'orders table with a per-order amount',
    sqlHint: 'average order amount over completed orders, current period vs previous period as two columns for the kpi comparison',
    defaultChartType: 'kpi',
    defaultImportance: 4,
  },
  {
    key: 'paying_conversion',
    category: 'revenue',
    title: '결제 전환율 (가입→첫 결제)',
    description: '가입 사용자 중 최소 1회 결제한 비율',
    requiredShapes: 'users joined to payments/orders by user id',
    sqlHint: 'share of users with at least one paid order; also the same share as of ~30 days ago as a second column for the kpi comparison',
    defaultChartType: 'kpi',
    defaultImportance: 4,
  },
  {
    key: 'refund_rate',
    category: 'revenue',
    title: '환불율',
    description: '전체 결제 대비 환불 비율',
    requiredShapes: 'orders/payments with a refunded status (or a refunds table)',
    sqlHint: 'refunded amount (or count) over total paid amount (or count), as a percentage',
    defaultChartType: 'line',
    defaultAlert: { type: 'threshold', operator: 'gt', threshold: 3 },
    defaultImportance: 4,
  },
  {
    key: 'churn_rate',
    category: 'revenue',
    title: '월 구독 해지율',
    description: '월 시작 활성 구독 대비 해지 비율',
    requiredShapes: 'subscriptions with cancel/expire transitions or a canceled_at column',
    sqlHint: 'subscriptions canceled in the month over active-at-start-of-month, as a percentage',
    defaultChartType: 'line',
    defaultAlert: { type: 'threshold', operator: 'gt', threshold: 5 },
    defaultImportance: 4,
  },
  {
    key: 'revenue_by_plan',
    category: 'revenue',
    title: '플랜별 매출 구성',
    description: '구독/주문 플랜별 매출 비중',
    requiredShapes: 'orders/subscriptions with a plan/tier column and amount',
    sqlHint: 'sum of revenue grouped by plan, one row per plan',
    defaultChartType: 'donut',
    defaultImportance: 3,
  },
  // ── engagement ──────────────────────────────────────────────────────────
  {
    key: 'core_action_count',
    category: 'engagement',
    title: '핵심 액션 수',
    description: '서비스 핵심 액션(분석 실행·주문·게시 등)의 일별 발생 수',
    requiredShapes: "the domain table for the product's core action, with a timestamp",
    sqlHint: "count of the product's defining action grouped by date; name it after the real domain action",
    defaultChartType: 'line',
    defaultAlert: { type: 'anomaly', sensitivity: 3 },
    defaultImportance: 4,
  },
  {
    key: 'retention_d7',
    category: 'engagement',
    title: '리텐션 (D1/D7/D30)',
    description: '가입 코호트의 재방문 유지율',
    requiredShapes: "user activity events plus each user's signup date",
    sqlHint: 'share of each signup cohort active again on day 1 / 7 / 30',
    defaultChartType: 'line',
    defaultImportance: 4,
  },
  {
    key: 'feature_adoption',
    category: 'engagement',
    title: '신규 기능 사용률',
    description: '특정 기능을 사용한 사용자 비율',
    requiredShapes: 'a feature-specific event or usage-flag table',
    sqlHint: 'share of active users who used a given feature in the period',
    defaultChartType: 'bar',
    defaultImportance: 3,
  },
  {
    key: 'actions_per_user',
    category: 'engagement',
    title: '유저당 액션 수',
    description: '활성 사용자 1인당 평균 액션 수',
    requiredShapes: 'an events table keyed by user id',
    sqlHint: 'total actions divided by distinct active users, current period vs previous period as two columns for the kpi comparison',
    defaultChartType: 'kpi',
    defaultImportance: 3,
  },
  // ── ops ─────────────────────────────────────────────────────────────────
  {
    key: 'payment_failure_rate',
    category: 'ops',
    title: '결제 실패율',
    description: '전체 결제 시도 대비 실패 비율',
    requiredShapes: 'payments/transactions with a failed status',
    sqlHint: 'failed payment attempts over total attempts per day, as a percentage',
    defaultChartType: 'line',
    defaultAlert: { type: 'threshold', operator: 'gt', threshold: 5 },
    defaultImportance: 4,
  },
  {
    key: 'webhook_failures',
    category: 'ops',
    title: '웹훅 처리 실패',
    description: '처리 실패한 웹훅 이벤트 수',
    requiredShapes: 'a webhook/event-log table with an error or failed flag',
    sqlHint: 'count of webhook rows in an error/failed state in the recent window',
    defaultChartType: 'bignumber',
    defaultAlert: { type: 'threshold', operator: 'gt', threshold: 0 },
    defaultImportance: 3,
  },
  {
    key: 'error_events',
    category: 'ops',
    title: '에러 이벤트 수',
    description: '일별 에러/예외 로그 발생 수',
    requiredShapes: 'an error/log table with a level/severity column and a timestamp',
    sqlHint: 'count of error-level log rows grouped by date',
    defaultChartType: 'line',
    defaultAlert: { type: 'anomaly', sensitivity: 3 },
    defaultImportance: 3,
  },
  {
    key: 'job_backlog',
    category: 'ops',
    title: '큐/잡 적체',
    description: '대기 중인 큐/작업 건수',
    requiredShapes: 'a jobs/queue table with a pending/queued status',
    sqlHint: 'count of jobs currently in a pending/queued state',
    defaultChartType: 'bignumber',
    defaultAlert: { type: 'threshold', operator: 'gt', threshold: 100 },
    defaultImportance: 3,
  },
  {
    key: 'signup_failures',
    category: 'ops',
    title: '가입 실패/중단',
    description: '실패하거나 중단된 가입 시도 수',
    requiredShapes: 'an auth/signup log capturing failed or abandoned attempts',
    sqlHint: 'count of failed/abandoned signup attempts grouped by date',
    defaultChartType: 'line',
    defaultAlert: { type: 'threshold', operator: 'gt', threshold: 10 },
    defaultImportance: 3,
  },
  // ── funnel ──────────────────────────────────────────────────────────────
  {
    key: 'funnel_conversion',
    category: 'funnel',
    title: '전환 퍼널 (방문→가입→활성→결제)',
    description: '핵심 퍼널 단계별 전환율',
    requiredShapes: 'an events table with distinct funnel-step events',
    sqlHint: 'count of users reaching each funnel step, one row per ordered step',
    defaultChartType: 'bar',
    defaultImportance: 4,
  },
]

// ── prompt rendering ────────────────────────────────────────────────────────

const CATEGORY_ORDER: KpiCategory[] = ['growth', 'revenue', 'engagement', 'ops', 'funnel', 'custom']

const CATEGORY_LABEL: Record<KpiCategory, string> = {
  growth: 'Growth',
  revenue: 'Revenue',
  engagement: 'Engagement',
  ops: 'Ops',
  funnel: 'Funnel',
  custom: 'Custom',
}

/** English label for a category — reused by the extraction prompt's scope directive. */
export function categoryLabel(cat: KpiCategory): string {
  return CATEGORY_LABEL[cat]
}

/** Compact `type operator threshold` / `anomaly` tail for the prompt menu. */
function renderAlertHint(alert: KpiAlertConfig | undefined): string {
  if (!alert) return ''
  if (alert.type === 'anomaly') return '; alert: anomaly'
  const parts = ['threshold']
  if (alert.operator) parts.push(alert.operator)
  if (alert.threshold !== undefined) parts.push(String(alert.threshold))
  return `; alert: ${parts.join(' ')}`
}

/**
 * A compact, numbered, category-grouped menu of the templates for the extraction prompt:
 *   `key · title — description (needs: requiredShapes; chart: type; alert: …)`.
 * Kept well under ~3500 chars so it can be inlined into the system/question prompt.
 *
 * `categories` (optional) restricts the menu to the given major categories — the user's
 * modal selection. Empty/undefined = the full menu. A category with no templates (e.g. `custom`,
 * which is code-derived at tier-2) simply contributes nothing.
 */
export function renderTemplatesForPrompt(categories?: KpiCategory[]): string {
  const only = categories && categories.length > 0 ? new Set(categories) : null
  const lines: string[] = []
  let n = 0
  for (const cat of CATEGORY_ORDER) {
    if (only && !only.has(cat)) continue
    const inCat = KPI_TEMPLATES.filter((t) => t.category === cat)
    if (inCat.length === 0) continue
    lines.push(`${CATEGORY_LABEL[cat]}:`)
    for (const t of inCat) {
      n += 1
      lines.push(
        `${n}. ${t.key} · ${t.title} — ${t.description} (needs: ${t.requiredShapes}; chart: ${t.defaultChartType}${renderAlertHint(t.defaultAlert)})`
      )
    }
  }
  return lines.join('\n')
}
