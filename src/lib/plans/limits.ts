/**
 * Plan limits — single source of truth (TypeScript, NOT the DB).
 *
 * Model: flat tiered subscriptions (Paddle charges the flat fee) + the app meters
 * usage per billing cycle and enforces these quotas. `-1` = unlimited.
 * See docs/paddle-billing-plan.md.
 */
import { isSelfHosted } from '@/config/edition'

export type PlanTier = 'free' | 'basic' | 'standard' | 'premium'

export interface PlanLimits {
  queries_per_month: number
  tokens_per_month: number
  database_connections: number
  team_members: number
  dashboards: number
  widgets_per_dashboard: number
  alerts_per_org: number
  integrations_per_org: number
  alert_min_check_interval: number // seconds — enforced per alert in alerts/runner.ts; floored to the 5-min cron period (premium's 60 reads as 5m until a 1-min scheduler exists)
  query_history_days: number
  /** Lifetime tier-2 (repo-based, LLM) context extractions per org. -1 = unlimited. */
  context_extractions_total: number
  /** Cooldown (hours) between push-triggered tier-2 context auto-regens per source.
   *  0 = auto-regen disabled — a push only marks the doc stale (regenerate manually). */
  context_auto_regen_cooldown_hours: number
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    queries_per_month: 15,
    tokens_per_month: 3_000_000, // internal safety ceiling; the binding limit is queries_per_month (a run ~100–300K tokens)
    database_connections: 1,
    team_members: 1,
    dashboards: 1,
    widgets_per_dashboard: 5,
    alerts_per_org: 3,
    integrations_per_org: 1,
    alert_min_check_interval: 7200, // 2h
    query_history_days: 7,
    context_extractions_total: 1, // one code-aware extraction on the house (spent by the attach auto-run)
    context_auto_regen_cooldown_hours: 0,
  },
  basic: {
    queries_per_month: 150, // cost-model derived (a run ≈ $0.05–0.20 on Sonnet; break-even ≈ 445 @ $89 → healthy margin under the 150 cap)
    tokens_per_month: 100_000_000, // internal safety ceiling; queries is the binding limit
    database_connections: 3,
    team_members: 5,
    dashboards: 5,
    widgets_per_dashboard: 20,
    alerts_per_org: 10,
    integrations_per_org: 3,
    alert_min_check_interval: 600, // 10m
    query_history_days: 30,
    context_extractions_total: -1, // manual regeneration any time (bounded by queries_per_month)
    context_auto_regen_cooldown_hours: 0, // push marks stale only — auto-freshness is the standard+ differentiator
  },
  standard: {
    queries_per_month: 750, // cost-model derived (break-even ≈ 1495 @ $299; well above the 750 cap)
    tokens_per_month: 1_000_000_000, // internal safety ceiling; queries is the binding limit
    database_connections: 10,
    team_members: 15,
    dashboards: 10,
    widgets_per_dashboard: 50,
    alerts_per_org: 50,
    integrations_per_org: 10,
    alert_min_check_interval: 300, // 5m
    query_history_days: 90,
    context_extractions_total: -1,
    context_auto_regen_cooldown_hours: 24, // ≤ ~30 auto-regens/source/month, each also metered as a query
  },
  premium: {
    queries_per_month: -1,
    tokens_per_month: -1,
    database_connections: -1,
    team_members: -1,
    dashboards: -1,
    widgets_per_dashboard: -1,
    alerts_per_org: -1,
    integrations_per_org: -1,
    alert_min_check_interval: 60, // 1m
    query_history_days: 365,
    context_extractions_total: -1,
    context_auto_regen_cooldown_hours: 6, // queries are unlimited on premium — this is the push-cost bound
  },
}

/** Marketed monthly price (USD) per tier. */
export const PLAN_PRICE_USD: Record<PlanTier, number> = { free: 0, basic: 89, standard: 299, premium: 899 }

/** Cheapest → most expensive, for upgrade ordering. */
export const PLAN_ORDER: PlanTier[] = ['free', 'basic', 'standard', 'premium']

export function isPlanTier(v: string | null | undefined): v is PlanTier {
  return v === 'free' || v === 'basic' || v === 'standard' || v === 'premium'
}

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  // A self-hosted install has no plans: every org gets the unlimited tier, whatever the
  // `organizations.plan` column says (it stays 'free' because nothing ever provisions it).
  if (isSelfHosted()) return PLAN_LIMITS.premium
  return isPlanTier(plan) ? PLAN_LIMITS[plan] : PLAN_LIMITS.free
}

export function getPlanLimit(plan: string | null | undefined, feature: keyof PlanLimits): number {
  return getPlanLimits(plan)[feature]
}

export function isUnlimited(limit: number): boolean {
  return limit === -1
}

/**
 * The plan whose limits actually APPLY: a paid tier entitles the org only while its
 * subscription is active/trialing — lapsed (past_due / paused / canceled) orgs are
 * enforced at FREE limits. This is the single rule shared by the quota gate
 * (checkUsageQuota) and every display surface (billing page, sidebar meter), so what
 * users see never disagrees with what enforcement does.
 */
export function entitledPlan(plan: string | null | undefined, subscriptionStatus: string | null | undefined): PlanTier {
  if (isSelfHosted()) return 'premium'
  const p: PlanTier = isPlanTier(plan) ? plan : 'free'
  if (p === 'free') return 'free'
  return subscriptionStatus === 'active' || subscriptionStatus === 'trialing' ? p : 'free'
}

/** Format a limit for display: unlimited → the caller's localized label. */
export function formatLimit(limit: number, unlimitedLabel: string, locale = 'en-US'): string {
  return isUnlimited(limit) ? unlimitedLabel : limit.toLocaleString(locale)
}
