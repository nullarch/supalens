// NOT `import 'server-only'` — reached from src/lib/data-sources/demo.ts on the Next.js server, and
// it writes through the same untyped service-role admin client + kpi service as src/lib/kpi/service.ts
// (kpi_catalog / kpi_extractions are member-read / service_role-write). No React/server imports.
import { completeExtraction, createExtraction, upsertProposals } from '@/lib/kpi/service'
import type { KpiAlertConfig, KpiCategory, KpiEvidence, KpiNoMonitor, KpiProposal } from '@/lib/kpi/types'
import type { VisualizationSpec } from '@/lib/viz/spec'
import { requireAdminClient } from '@/utils/supabase/admin'
import { DEMO_KPI_SAMPLES } from './demo-catalog-samples'

/**
 * The demo's canned KPI catalog — a hand-authored, ZERO-LLM seed for the shared e-commerce demo
 * source. This is touchpoint 0 in docs/auto-kpi-plan.md: first-visit users see the OUTPUT of
 * Auto-KPI within seconds without paying for an extraction.
 *
 * Every `metric_sql` is REAL SQL that runs against the demo schema (demo/seed.sql, a US-dollar
 * apparel store whose dates roll forward with the calendar):
 *   customers(id, name, email, country, signup_date)
 *   products(id, name, category, price)          -- category ∈ {Apparel, Footwear, Accessories}
 *   orders(id, customer_id, order_date, status, total_amount)  -- status ∈ {paid, refunded, pending}
 *   order_items(id, order_id, product_id, quantity, unit_price)
 * It is re-run live when a widget refreshes (and, for alert-carrying KPIs, by the alert runner), so
 * the SQL is authored to be correct against that schema. Each vizSpec carries a `sample` generated
 * from the demo database (demo-catalog-samples.ts, `node scripts/refresh-demo-catalog-samples.mjs`)
 * for instant preview without a live query.
 */

type Chart = VisualizationSpec['chart']
type Sample = NonNullable<VisualizationSpec['sample']>

/** Build a proposal, binding vizSpec.query.sql = metricSql so the preview and the live re-run agree. */
function proposal(p: {
  key: string
  title: string
  category: KpiCategory
  description: string
  importance: number
  sql: string
  chart: Chart
  alertConfig?: KpiAlertConfig
  noMonitor?: KpiNoMonitor
  evidence: KpiEvidence[]
}): KpiProposal {
  const sample: Sample = DEMO_KPI_SAMPLES[p.key] ?? { columns: [], rows: [] }
  return {
    key: p.key,
    title: p.title,
    category: p.category,
    description: p.description,
    importance: p.importance,
    metricSql: p.sql,
    vizSpec: { v: 1, query: { sql: p.sql }, sample, chart: p.chart },
    alertConfig: p.alertConfig,
    noMonitor: p.noMonitor,
    evidence: p.evidence,
  }
}

const usdCompact = { kind: 'currency', currency: 'USD', compact: true } as const
const dayAxis = { kind: 'date', dateGranularity: 'day' } as const

/** Titles of this catalog version. A stored demo catalog with other titles predates it. */
export const DEMO_KPI_CATALOG_MARKER = { key: 'total_revenue', title: 'Total revenue (GMV)' } as const

export const DEMO_KPI_PROPOSALS: KpiProposal[] = [
  // ── revenue ───────────────────────────────────────────────────────────────
  proposal({
    key: 'total_revenue',
    title: DEMO_KPI_CATALOG_MARKER.title,
    category: 'revenue',
    description: 'Revenue from all paid orders',
    importance: 5,
    sql: `select coalesce(sum(total_amount), 0) as gmv
from orders
where status = 'paid'`,
    chart: {
      type: 'bignumber',
      title: 'Total revenue (GMV)',
      value: 'gmv',
      caption: 'Paid orders, all time',
      format: usdCompact,
    },
    noMonitor: {
      kind: 'none',
      reason: 'snapshot_only',
      note: 'A running total only grows, so its latest value cannot show whether something is wrong.',
    },
    evidence: [{ kind: 'table', ref: 'orders', note: "Sum of total_amount where status = 'paid'" }],
  }),
  proposal({
    key: 'daily_revenue',
    title: 'Daily revenue',
    category: 'revenue',
    description: 'Paid revenue per day over the last 30 days',
    importance: 5,
    sql: `select date_trunc('day', order_date)::date as day,
       sum(total_amount) as revenue
from orders
where status = 'paid'
  and order_date >= now() - interval '30 days'
group by 1
order by 1`,
    chart: {
      type: 'bar',
      title: 'Daily revenue (30 days)',
      x: 'day',
      y: 'revenue',
      orientation: 'vertical',
      xFormat: dayAxis,
      yFormat: usdCompact,
    },
    alertConfig: { type: 'anomaly', sensitivity: 3, direction: 'down' },
    evidence: [{ kind: 'table', ref: 'orders', note: 'Paid revenue by day' }],
  }),
  proposal({
    key: 'aov',
    title: 'Average order value (AOV)',
    category: 'revenue',
    description: 'Average amount of a paid order',
    importance: 4,
    sql: `select round(avg(total_amount), 2) as aov
from orders
where status = 'paid'`,
    chart: {
      type: 'bignumber',
      title: 'Average order value (AOV)',
      value: 'aov',
      caption: 'Paid orders',
      format: { kind: 'currency', currency: 'USD' },
    },
    noMonitor: {
      kind: 'none',
      reason: 'not_time_series',
      note: 'One all-time average has no series to compare against.',
    },
    evidence: [{ kind: 'table', ref: 'orders', note: 'Average total_amount of paid orders' }],
  }),
  proposal({
    key: 'refund_rate',
    title: 'Refund rate',
    category: 'revenue',
    description: 'Share of settled orders that were refunded (%)',
    importance: 4,
    sql: `select round(100.0 * count(*) filter (where status = 'refunded')
             / nullif(count(*) filter (where status in ('paid', 'refunded')), 0), 2) as refund_rate
from orders`,
    chart: {
      type: 'bignumber',
      title: 'Refund rate',
      value: 'refund_rate',
      caption: 'Refunded ÷ (paid + refunded)',
      format: { kind: 'number', decimals: 1, unit: '%' },
    },
    alertConfig: { type: 'threshold', operator: 'gt', threshold: 10 },
    evidence: [{ kind: 'table', ref: 'orders', note: "Orders with status = 'refunded' among settled orders" }],
  }),
  proposal({
    key: 'revenue_by_category',
    title: 'Revenue by category',
    category: 'revenue',
    description: 'Paid revenue split by product category',
    importance: 4,
    sql: `select p.category,
       sum(oi.quantity * oi.unit_price) as revenue
from order_items oi
join products p on p.id = oi.product_id
join orders o on o.id = oi.order_id
where o.status = 'paid'
group by p.category
order by revenue desc`,
    chart: {
      type: 'donut',
      title: 'Revenue by category',
      category: 'category',
      value: 'revenue',
      valueFormat: usdCompact,
    },
    noMonitor: {
      kind: 'none',
      reason: 'categorical',
      note: 'A category breakdown has no single measure to monitor.',
    },
    evidence: [
      { kind: 'table', ref: 'order_items', note: 'Revenue summed by products.category' },
      { kind: 'table', ref: 'products' },
    ],
  }),
  proposal({
    key: 'top_products',
    title: 'Top products by revenue',
    category: 'revenue',
    description: 'Products with the most paid revenue',
    importance: 3,
    sql: `select p.name,
       sum(oi.quantity * oi.unit_price) as revenue,
       sum(oi.quantity) as units
from order_items oi
join products p on p.id = oi.product_id
join orders o on o.id = oi.order_id
where o.status = 'paid'
group by p.name
order by revenue desc
limit 10`,
    chart: {
      type: 'table',
      title: 'Top products by revenue',
      columns: [
        { key: 'name', label: 'Product' },
        { key: 'revenue', label: 'Revenue', format: usdCompact, align: 'right' },
        { key: 'units', label: 'Units', format: { kind: 'number' }, align: 'right' },
      ],
      sort: { by: 'revenue', dir: 'desc' },
    },
    noMonitor: {
      kind: 'none',
      reason: 'categorical',
      note: 'A ranked product list cannot be monitored as one metric.',
    },
    evidence: [
      { kind: 'table', ref: 'order_items', note: 'Top 10 products by revenue' },
      { kind: 'table', ref: 'products' },
    ],
  }),
  // ── growth ────────────────────────────────────────────────────────────────
  proposal({
    key: 'new_signups',
    title: 'Daily signups',
    category: 'growth',
    description: 'New customer signups per day over the last 30 days',
    importance: 5,
    sql: `select signup_date as day,
       count(*) as signups
from customers
where signup_date >= current_date - 29
group by 1
order by 1`,
    chart: {
      type: 'line',
      title: 'Daily signups (30 days)',
      x: 'day',
      y: 'signups',
      curve: 'smooth',
      xFormat: dayAxis,
      yFormat: { kind: 'number' },
    },
    alertConfig: { type: 'anomaly', sensitivity: 3, direction: 'down' },
    evidence: [{ kind: 'table', ref: 'customers', note: 'Signups counted by signup_date' }],
  }),
  proposal({
    key: 'paying_conversion',
    title: 'Paying customer rate',
    category: 'growth',
    description: 'Share of customers with at least one paid order (%)',
    importance: 4,
    sql: `select round(100.0 * count(distinct o.customer_id)
             / nullif((select count(*) from customers), 0), 1) as paying_rate
from orders o
where o.status = 'paid'`,
    chart: {
      type: 'bignumber',
      title: 'Paying customer rate',
      value: 'paying_rate',
      caption: 'Customers with a paid order',
      format: { kind: 'number', decimals: 1, unit: '%' },
    },
    noMonitor: {
      kind: 'none',
      reason: 'not_time_series',
      note: 'A single point-in-time ratio has no daily series.',
    },
    evidence: [
      { kind: 'table', ref: 'orders', note: 'Distinct customers with a paid order' },
      { kind: 'table', ref: 'customers', note: 'All customers' },
    ],
  }),
  // ── engagement ──────────────────────────────────────────────────────────────
  proposal({
    key: 'order_count',
    title: 'Daily orders',
    category: 'engagement',
    description: 'All orders per day over the last 14 days',
    importance: 4,
    sql: `select date_trunc('day', order_date)::date as day,
       count(*) as orders
from orders
where order_date >= now() - interval '14 days'
group by 1
order by 1`,
    chart: {
      type: 'line',
      title: 'Daily orders (14 days)',
      x: 'day',
      y: 'orders',
      curve: 'smooth',
      xFormat: dayAxis,
      yFormat: { kind: 'number' },
    },
    alertConfig: { type: 'anomaly', sensitivity: 3, direction: 'down' },
    evidence: [{ kind: 'table', ref: 'orders', note: 'All orders by day' }],
  }),
  proposal({
    key: 'daily_active_buyers',
    title: 'Daily buyers',
    category: 'engagement',
    description: 'Unique paying customers per day over the last 30 days',
    importance: 4,
    sql: `select date_trunc('day', order_date)::date as day,
       count(distinct customer_id) as buyers
from orders
where status = 'paid'
  and order_date >= now() - interval '30 days'
group by 1
order by 1`,
    chart: {
      type: 'line',
      title: 'Daily buyers (30 days)',
      x: 'day',
      y: 'buyers',
      curve: 'smooth',
      xFormat: dayAxis,
      yFormat: { kind: 'number' },
    },
    alertConfig: { type: 'anomaly', sensitivity: 3, direction: 'down' },
    evidence: [{ kind: 'table', ref: 'orders', note: 'Distinct paying customers by day' }],
  }),
]

/**
 * Seed the demo source's canned KPI catalog. Idempotent + cheap: one lookup of the marker row.
 * No rows → create a tier-1 extraction, upsert the canned proposals and mark it completed. A catalog
 * from an older demo dataset (different marker title, e.g. the retired KRW catalog) is refreshed the
 * same way; upsertProposals keeps each KPI's review status and applied dashboards/monitors.
 * Never auto-applies — proposals are reviewed like any other extraction (no zero-click writes).
 */
export async function ensureDemoKpiCatalog(orgId: string, dataSourceId: string): Promise<void> {
  const db = requireAdminClient()

  const { data, error } = await db
    .from('kpi_catalog')
    .select('key, title')
    .eq('data_source_id', dataSourceId)
    .eq('key', DEMO_KPI_CATALOG_MARKER.key)
    .limit(1)
  if (error) throw new Error(`[kpi] ensureDemoKpiCatalog (lookup) failed: ${error.message}`)
  const marker = (data?.[0] as { key: string; title: string } | undefined) ?? null
  if (marker?.title === DEMO_KPI_CATALOG_MARKER.title) return

  const { id: extractionId } = await createExtraction({ orgId, dataSourceId, tier: 1 })
  await upsertProposals({ orgId, dataSourceId, extractionId, proposals: DEMO_KPI_PROPOSALS })
  await completeExtraction(extractionId, DEMO_KPI_PROPOSALS.length)
}
