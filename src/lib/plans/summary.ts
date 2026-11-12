// NOT `import 'server-only'` — sibling of usage.ts. Billing summary for the billing
// page + sidebar meter. Reads billing/usage via the service-role admin client.
import { createAdminClient } from '@/utils/supabase/admin'
import { entitledPlan, getPlanLimits, isPlanTier, type PlanLimits, type PlanTier } from './limits'
import { overageEnabled, computeOverageQueries, overageCostUsd, getOverageRateUsd } from './overage'

export interface BillingTxn {
  id: string
  date: string | null
  amountCents: number | null
  currency: string | null
  status: string | null
}

export interface BillingSummary {
  /** The SUBSCRIBED tier (what the org pays for) — display in the plan banner. */
  plan: PlanTier
  /** The tier whose limits actually apply right now (free when the subscription lapsed) —
   *  `limits` below is derived from THIS, matching checkUsageQuota's enforcement. */
  effectivePlan: PlanTier
  subscriptionStatus: string | null
  periodStart: string | null
  periodEnd: string | null
  scheduledChange: { action?: string; effective_at?: string } | null
  hasBilling: boolean
  usage: { queries: number; tokens: number; connections: number; members: number; alerts: number; dashboards: number }
  limits: PlanLimits
  /** Overage state when usage-based overage is enabled (else null). `queries` = excess over the cap. */
  overage: { enabled: boolean; queries: number; estUsd: number; ratePerQueryUsd: number } | null
  transactions: BillingTxn[]
}

export async function getBillingSummary(orgId: string): Promise<BillingSummary | null> {
  const admin = createAdminClient()
  if (!admin) return null

  const { data: orgRows } = await admin
    .from('organizations')
    .select(
      'plan, subscription_status, paddle_customer_id, current_period_starts_at, current_period_ends_at, current_period_query_count, current_period_token_count, scheduled_change',
    )
    .eq('id', orgId)
    .limit(1)
  const org = orgRows?.[0] as
    | {
        plan: string | null
        subscription_status: string | null
        paddle_customer_id: string | null
        current_period_starts_at: string | null
        current_period_ends_at: string | null
        current_period_query_count: number | null
        current_period_token_count: number | null
        scheduled_change: { action?: string; effective_at?: string } | null
      }
    | undefined
  if (!org) return null

  const [conn, mem, alert, dash, txns] = await Promise.all([
    admin.from('data_sources').select('*', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
    admin.from('organization_members').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('alerts').select('*', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
    admin.from('dashboards').select('*', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
    admin
      .from('billing_transactions')
      .select('id, status, amount_cents, currency, billed_at')
      .eq('org_id', orgId)
      .order('billed_at', { ascending: false })
      .limit(10),
  ])

  const plan: PlanTier = isPlanTier(org.plan) ? org.plan : 'free'
  const effective = entitledPlan(plan, org.subscription_status)
  const txnRows = (txns.data ?? []) as Array<{
    id: string
    status: string | null
    amount_cents: number | null
    currency: string | null
    billed_at: string | null
  }>

  const overageQ = computeOverageQueries(effective, org.current_period_query_count ?? 0)
  const overage = overageEnabled()
    ? { enabled: true, queries: overageQ, estUsd: overageCostUsd(overageQ), ratePerQueryUsd: getOverageRateUsd() }
    : null

  return {
    plan,
    effectivePlan: effective,
    subscriptionStatus: org.subscription_status,
    periodStart: org.current_period_starts_at,
    periodEnd: org.current_period_ends_at,
    scheduledChange: org.scheduled_change ?? null,
    hasBilling: Boolean(org.paddle_customer_id),
    overage,
    usage: {
      queries: org.current_period_query_count ?? 0,
      tokens: org.current_period_token_count ?? 0,
      connections: conn.count ?? 0,
      members: mem.count ?? 0,
      alerts: alert.count ?? 0,
      dashboards: dash.count ?? 0,
    },
    // limits from the EFFECTIVE plan — the meters must show what enforcement actually applies
    // (a past_due org displaying "12 / 750" while being blocked at 15 is a support ticket)
    limits: getPlanLimits(effective),
    transactions: txnRows.map((t) => ({
      id: t.id,
      date: t.billed_at,
      amountCents: t.amount_cents,
      currency: t.currency,
      status: t.status,
    })),
  }
}
