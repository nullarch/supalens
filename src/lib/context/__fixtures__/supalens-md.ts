/**
 * Fixtures for the SUPALENS.md parser + the /dev/business-model preview.
 * REPO_TIER mirrors what the tier-2 generator emits for CONTEXT_GEN_PROMPT (mixed bullet /
 * pipe-table / nested-list / code-fence forms); BASELINE_TIER is byte-compatible with
 * baseline.ts::renderBaselineMarkdown.
 */

export const REPO_TIER = `# dailycart — SUPALENS.md

DailyCart is a B2C grocery subscription app (Next.js + Prisma) on PostgreSQL 15. Money is stored in KRW integer won; timestamps are UTC.

## Entity ↔ table map

| Entity | Table | Notes |
|---|---|---|
| Customer | \`customers\` | one row per signed-up shopper |
| Subscription | \`subscriptions\` | weekly box plan; see status codes |
| Order | \`orders\` | one row per delivery attempt |
| Payment | \`payments\` | Toss Payments confirmations |
- **Refund** → \`refunds\` — partial refunds allowed (\`amount\` ≤ payment amount)
- Coupon: \`coupons\` (issued) and \`coupon_redemptions\` (used)

## Key tables and columns

### orders
- \`total_amount\` — KRW integer, includes shipping (\`shipping_fee\`)
- \`status\` — see Enum section
- \`placed_at\` is the business date used by all revenue reports (\`src/lib/reports/revenue.ts:41\`)

### subscriptions
- \`plan\` — \`weekly\` | \`biweekly\`
- \`trial\` boolean — trial boxes are excluded from MRR (\`src/lib/billing/mrr.ts:18\`)

## Enum / status / coded values

- \`orders.status\`:
  - \`pending\` → created, not yet paid
  - \`paid\` → payment confirmed (counts as revenue)
  - \`shipped\`, \`delivered\` → fulfilled (still revenue)
  - \`cancelled\`, \`refunded\` → excluded from revenue (\`src/lib/reports/revenue.ts:52-58\`)
- \`subscriptions.status\` = 1 → "active", 2 → "paused", 3 → "cancelled" (\`prisma/schema.prisma:88\`)
- \`payments.provider\` is always \`toss\` today (unconfirmed whether legacy \`kakao\` rows still exist)

## Relationships & join patterns

- \`orders.customer_id\` → \`customers.id\`; a customer can have many orders
- \`payments.order_id\` → \`orders.id\` (1:1 in practice, enforced only in code \`src/lib/payments/confirm.ts:120\`)
- \`refunds.payment_id\` → \`payments.id\`

## Common query patterns & important filters

- Live rows: every table with \`deleted_at\` must be filtered \`deleted_at is null\`
- Internal test accounts: \`customers.email like '%@dailycart.dev'\` are excluded from all KPIs (\`src/lib/reports/filters.ts:9\`)
- Revenue = sum(\`orders.total_amount\`) where \`status in ('paid','shipped','delivered')\` and \`placed_at\` in range

## Gotchas

- \`total_amount\` already includes VAT — do not add 10% again
- \`placed_at\` is UTC; Korean business day = \`placed_at at time zone 'Asia/Seoul'\`

## Suggested KPIs

- **MRR** — sum of active, non-trial subscription plan prices
\`\`\`sql
select sum(price) from subscriptions where status = 1 and trial = false and deleted_at is null
\`\`\`
- **Refund rate** — refunded payments / paid payments, last 30 days
\`\`\`sql
select count(*) filter (where status = 'refunded')::float / nullif(count(*),0) from orders where placed_at > now() - interval '30 days'
\`\`\`
`

export const BASELINE_TIER = `# shop-prod — data source context (auto-generated baseline)

This is a postgres database with 4 table(s). This baseline is generated from the introspected schema only. Attach a git repository to this data source to enrich it with code-derived business meaning (what each table/field represents, enum/status codes, relationships, and common query patterns).

## Detected conventions
- Soft delete: rows with \`deleted_at\` set are deleted — filter \`deleted_at is null\` for live rows.
- Timestamps: \`created_at\` / \`updated_at\` are present for recency and ordering.

## Tables

### customers
- \`id\` uuid [pk]
- \`name\` text
- \`email\` text
- \`country\` text [nullable]
- \`signup_date\` date

### orders
- \`id\` uuid [pk]
- \`customer_id\` uuid [fk?]
- \`order_date\` timestamptz
- \`status\` text
- \`total_amount\` numeric
- \`deleted_at\` timestamptz [nullable]

### products
- \`id\` uuid [pk]
- \`name\` text
- \`category\` text
- \`price\` numeric

### analytics.daily_sales (view)
- \`day\` date
- \`revenue\` numeric
`
