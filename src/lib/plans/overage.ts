// Usage-based overage — the "don't hard-block at the cap, bill the excess" layer.
//
// Deliberately GATED and env-PRICED: with OVERAGE_BILLING_ENABLED unset/false (default) this is a full
// no-op and the monthly query cap stays a hard 402 block (the pre-overage behavior). The rate is a
// BUSINESS decision — set OVERAGE_USD_PER_QUERY and validate it against real agent_runs.cost_usd BEFORE
// enabling, or you can bill below cost. NOT `import 'server-only'` — shared with the Trigger runtime
// (the renewal charge path). Only imports from ./limits, so no cycle with usage.ts.
import { getPlanLimit, isUnlimited } from './limits'

// Inlined (not imported from usage.ts) to avoid a usage ↔ overage import cycle.
// Webhook secret NOT required — provisioning also runs webhook-less via paddle/sync.ts.
function billingConfigured(): boolean {
  return Boolean(process.env.PADDLE_API_KEY)
}

/** $ per query over the plan cap. 0 (the default) means overage is off. */
export function getOverageRateUsd(): number {
  const r = Number(process.env.OVERAGE_USD_PER_QUERY ?? 0)
  return Number.isFinite(r) && r > 0 ? r : 0
}

/** Overage is LIVE only when billing is configured, the flag is on, AND a positive rate is set. */
export function overageEnabled(): boolean {
  return billingConfigured() && process.env.OVERAGE_BILLING_ENABLED === 'true' && getOverageRateUsd() > 0
}

/** How many queries this org is OVER its plan cap (0 for unlimited plans or under the cap). */
export function computeOverageQueries(plan: string, queryCount: number): number {
  const limit = getPlanLimit(plan, 'queries_per_month')
  if (isUnlimited(limit)) return 0
  return Math.max(0, queryCount - limit)
}

/** Estimated overage charge in USD, rounded to cents. */
export function overageCostUsd(overageQueries: number): number {
  return Math.round(overageQueries * getOverageRateUsd() * 100) / 100
}
