// Dev-preview fixture (/dev/xray): the "dailycart" example from the design, in the exact shape
// submit_xray stores. Fictional repo — never served on a public route.
import type { XrayEvent } from '../events'
import { finalizeReport, type XrayReport } from '../schema'

export const DAILYCART_REPORT: XrayReport = finalizeReport(
  {
    productName: 'dailycart',
    headline: 'dailycart counts its revenue two different ways.',
    summary:
      "Billing subtracts refunds. The admin dashboard doesn't, so the number the team sees every day runs high. That's one of three metric traps in 214 files.",
    businessModel: 'A subscription business with usage credits',
    moneyFlow: {
      steps: [
        { label: 'Sign-up', entity: 'users', ref: 'auth/signup.ts:20' },
        { label: '7-day trial', entity: 'trials', ref: 'billing/trial.ts:14' },
        { label: 'Monthly · yearly plan', entity: 'subscriptions', ref: 'billing/checkout.ts:88' },
        { label: 'Payment', entity: 'payments', ref: 'payments/charge.ts:33' },
        { label: 'Renewal', entity: 'renewed_at', ref: 'billing/renew.ts:9' },
      ],
      branches: [
        { label: 'Cancellation', detail: 'Leaves MRR · cancel.ts:15', under: 3 },
        { label: 'Refund', detail: 'Subtracted in 1 of 2 places · trap 01', under: 4, trap: 1 },
      ],
      note: { label: 'credits', text: 'Credits are charged only when a generation succeeds.', ref: 'credits/consume.ts:57' },
    },
    traps: [
      {
        title: 'The admin dashboard never subtracts refunds',
        explanation: 'Billing computes revenue net of refunds. The admin total sums every paid payment, refunded or not.',
        severity: 'certain',
        area: 'Revenue',
        impact: ['MRR'],
        sides: [
          {
            label: 'Billing',
            verdict: 'right',
            path: 'billing/mrr.ts',
            startLine: 39,
            endLine: 43,
            highlight: [41],
            lines: [
              { n: 39, text: 'select' },
              { n: 40, text: '  sum(p.amount)' },
              { n: 41, text: '  - coalesce(sum(r.amount), 0)', mark: 'good' },
              { n: 42, text: 'from payments p' },
              { n: 43, text: 'left join refunds r using (payment_id)' },
            ],
          },
          {
            label: 'Admin dashboard',
            verdict: 'wrong',
            path: 'api/admin/revenue.ts',
            startLine: 42,
            endLine: 46,
            highlight: [43],
            lines: [
              { n: 42, text: 'select' },
              { n: 43, text: '  sum(p.amount)', mark: 'bad' },
              { n: 44, text: 'from payments p' },
              { n: 45, text: "where p.status = 'paid'" },
              { n: 46, text: '-- refunds table never joined' },
            ],
          },
        ],
        fix: {
          path: 'api/admin/revenue.ts',
          lines: [
            { op: ' ', text: 'select' },
            { op: '-', text: '  sum(p.amount)' },
            { op: '+', text: '  sum(p.amount) - coalesce(sum(r.amount), 0)' },
            { op: ' ', text: 'from payments p' },
            { op: '+', text: 'left join refunds r using (payment_id)' },
            { op: ' ', text: "where p.status = 'paid'" },
          ],
        },
      },
      {
        title: 'Deleted accounts still count as active users',
        explanation: 'Analytics excludes deleted accounts. Admin stats keeps them, so the two numbers drift apart as churn grows.',
        severity: 'certain',
        area: 'Active users',
        impact: ['Retention'],
        sides: [
          {
            label: 'Analytics',
            verdict: 'right',
            path: 'lib/analytics.ts',
            startLine: 11,
            endLine: 13,
            highlight: [13],
            lines: [
              { n: 11, text: 'from users' },
              { n: 12, text: "where last_seen_at > now() - interval '30 days'" },
              { n: 13, text: '  and deleted_at is null', mark: 'good' },
            ],
          },
          {
            label: 'Admin stats',
            verdict: 'wrong',
            path: 'admin/stats.ts',
            startLine: 30,
            endLine: 31,
            highlight: [31],
            lines: [
              { n: 30, text: 'from users' },
              { n: 31, text: "where last_seen_at > now() - interval '30 days'", mark: 'bad' },
            ],
          },
        ],
        fix: {
          path: 'admin/stats.ts',
          lines: [
            { op: ' ', text: "where last_seen_at > now() - interval '30 days'" },
            { op: '+', text: '  and deleted_at is null' },
          ],
        },
      },
      {
        title: 'Staff test accounts may inflate trial conversion',
        explanation: 'isInternal() exists, but the conversion report never calls it. Only the data can show how many staff accounts sit inside.',
        severity: 'needs_data',
        area: 'Conversion',
        sides: [
          {
            label: 'Staff filter',
            verdict: 'right',
            path: 'lib/accounts.ts',
            startLine: 22,
            endLine: 23,
            highlight: [23],
            lines: [
              { n: 22, text: 'export const isInternal = (u: User) =>' },
              { n: 23, text: "  u.email.endsWith('@dailycart.io')", mark: 'good' },
            ],
          },
          {
            label: 'Conversion report',
            verdict: 'wrong',
            path: 'reports/conversion.sql',
            startLine: 6,
            endLine: 8,
            highlight: [8],
            lines: [
              { n: 6, text: 'from trials t' },
              { n: 7, text: 'join subscriptions s using (user_id)' },
              { n: 8, text: "where t.started_at >= date_trunc('month', now())", mark: 'bad' },
            ],
          },
        ],
      },
    ],
    kpis: [
      { name: 'New sign-ups', ref: 'auth/signup.ts:20', watch: 'anomaly' },
      { name: 'Trial → paid', ref: 'billing/checkout.ts:88', watch: 'anomaly' },
      { name: 'MRR', ref: 'billing/mrr.ts:41', watch: 'anomaly' },
      { name: 'Churn', ref: 'billing/cancel.ts:15', watch: 'threshold' },
      { name: 'Refund rate', ref: 'payments/refund.ts:30', watch: 'threshold' },
      { name: 'Credit burn', ref: 'credits/consume.ts:57', watch: 'anomaly' },
    ],
    areas: [
      { name: 'Revenue', status: 'split', note: '2 definitions' },
      { name: 'Active users', status: 'split', note: '2 definitions' },
      { name: 'Conversion', status: 'needs_data', note: 'needs data' },
      { name: 'Credits', status: 'consistent', note: 'consistent' },
    ],
    supabase: { found: true, evidence: ['package.json (@supabase/supabase-js)', 'supabase/migrations/'] },
    rulesRead: 14,
  },
  214,
)

/** A scan caught mid-way (stage 4), for the scan preview. */
export const DAILYCART_EVENTS: XrayEvent[] = [
  { type: 'cloned', files: 214 },
  { type: 'read', path: 'package.json' },
  { type: 'read', path: 'supabase/migrations/20260102_init.sql' },
  { type: 'note', kind: 'entity', text: '6 entities: users, trials, subscriptions, payments, refunds, credits', count: 6 },
  { type: 'read', path: 'billing/checkout.ts' },
  { type: 'note', kind: 'rule', text: 'A 7-day trial converts to a monthly or yearly plan' },
  { type: 'read', path: 'billing/mrr.ts' },
  { type: 'read', path: 'api/admin/revenue.ts' },
  { type: 'note', kind: 'trap', text: 'Revenue is computed in two places. Only one subtracts refunds.' },
  { type: 'search', pattern: 'deleted_at' },
  { type: 'read', path: 'lib/analytics.ts' },
  { type: 'read', path: 'admin/stats.ts' },
  { type: 'note', kind: 'trap', text: '"Active users" has two definitions.' },
  { type: 'read', path: 'lib/accounts.ts' },
  { type: 'note', kind: 'kpi', text: 'Trial → paid conversion, defined in billing/checkout.ts' },
  { type: 'read', path: 'payments/refund.ts' },
]
