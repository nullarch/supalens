// NOT `import 'server-only'` — metering may run on the Trigger.dev host (shared
// convention, see src/utils/supabase/admin.ts). Uses the service-role admin client
// (billing columns are service-role managed; a guard trigger blocks client roles).
import * as Sentry from '@sentry/node'

import { isSelfHosted } from '@/config/edition'
import { createAdminClient } from '@/utils/supabase/admin'
import { getServerTranslator, normalizeLocale } from '@/lib/i18n/server-translator'
import { entitledPlan, getPlanLimit, isUnlimited, type PlanTier, type PlanLimits } from './limits'
import { addMonthsClamped } from './period'

/** User-facing quota/limit strings, in the REQUESTER's locale (never hardcoded Korean — the
 *  paying-moment message must render in the viewer's language). Request-free translator so the
 *  same code serves Vercel AND the Trigger host. Callers that surface no message may omit locale. */
async function quotaT(locale?: string) {
  const loc = normalizeLocale(locale)
  const t = await getServerTranslator(loc, 'quota')
  const num = (n: number) => new Intl.NumberFormat(loc === 'ko' ? 'ko-KR' : loc === 'ja' ? 'ja-JP' : 'en-US').format(n)
  return { t, num }
}
import { overageEnabled, computeOverageQueries, overageCostUsd } from './overage'
import { reconcileOrgSubscription } from '@/lib/paddle/sync'

/**
 * Plan enforcement only applies once billing is actually live (Paddle configured). Before that a
 * user has no way to upgrade, so capping them would strand them ("over limit, can't pay") — so
 * enforcement is a NO-OP and everyone runs unlimited (the pre-billing behavior). Caps + checkout
 * flip on together the moment PADDLE_API_KEY is set (the webhook secret is optional — provisioning
 * also runs webhook-less via the API-verified checkout sync in paddle/sync.ts).
 */
export function billingActive(): boolean {
  return Boolean(process.env.PADDLE_API_KEY)
}

interface OrgUsageRow {
  plan: PlanTier | null
  subscription_status: string | null
  current_period_starts_at: string | null
  current_period_ends_at: string | null
  current_period_query_count: number | null
  current_period_token_count: number | null
}

export interface UsageCheck {
  allowed: boolean
  reason?: string
  limitType?: 'queries' | 'tokens'
  plan: string
  queries: { used: number; limit: number }
  tokens: { used: number; limit: number }
  /** Present when the run is allowed but OVER the plan cap (overage billing on): the accruing excess. */
  overage?: { queries: number; estUsd: number }
}

/**
 * Metered pre-run gate: is this org under its monthly query AND token budget?
 * Reads billing/usage via the service-role client. Lazily resets the window for
 * free / inactive plans (paid renewals are reset by Paddle webhooks). Fails OPEN
 * when billing isn't configured (admin client null) so local dev still works.
 */
export async function checkUsageQuota(orgId: string, opts?: { locale?: string }): Promise<UsageCheck> {
  const admin = createAdminClient()
  if (!admin) {
    return { allowed: true, plan: 'free', queries: { used: 0, limit: -1 }, tokens: { used: 0, limit: -1 } }
  }

  // Billing-INDEPENDENT abuse cap: applies even before Paddle is configured, so an open signup
  // can't burn the host LLM key unbounded. Counts this org's agent_runs in the last 24h.
  // Self-hosted default is 0 (off): the operator owns the LLM key and decides who can sign up.
  const dayCap = Number(process.env.MAX_RUNS_PER_ORG_PER_DAY ?? (isSelfHosted() ? 0 : 200))
  if (Number.isFinite(dayCap) && dayCap > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    // Count EVERY LLM-spawning table. Each writes to a different table and none is a subset of
    // agent_runs: code analysis → code_analysis_runs, KPI extraction → kpi_extractions (it calls
    // runAnalysis/runCodeAnalysis directly, inserting NO agent_runs row — so an agent_runs-only cap
    // left it completely uncapped, the one live guard when Paddle is unconfigured).
    const [aRuns, cRuns, kExtractions] = await Promise.all([
      admin.from('agent_runs').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', since),
      admin.from('code_analysis_runs').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', since),
      admin.from('kpi_extractions').select('*', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', since),
    ])
    const runs24h = (aRuns.count ?? 0) + (cRuns.count ?? 0) + (kExtractions.count ?? 0)
    if (runs24h >= dayCap) {
      const { t } = await quotaT(opts?.locale)
      return {
        allowed: false,
        reason: t('dailyCapReached', { cap: dayCap }),
        plan: 'free',
        queries: { used: runs24h, limit: dayCap },
        tokens: { used: 0, limit: -1 },
      }
    }
  }

  if (!billingActive()) {
    return { allowed: true, plan: 'free', queries: { used: 0, limit: -1 }, tokens: { used: 0, limit: -1 } }
  }
  const { data, error } = await admin
    .from('organizations')
    .select(
      'plan, subscription_status, current_period_starts_at, current_period_ends_at, current_period_query_count, current_period_token_count',
    )
    .eq('id', orgId)
    .limit(1)
  if (error) {
    // Billing columns not migrated yet (or a transient error) → fail OPEN so analysis is
    // never hard-blocked by a deploy-before-migration. Metering resumes once migrated.
    console.error('[billing] usage check skipped (failing open):', error.message)
    return { allowed: true, plan: 'free', queries: { used: 0, limit: -1 }, tokens: { used: 0, limit: -1 } }
  }
  const org = (data?.[0] as OrgUsageRow | undefined) ?? null
  if (!org) {
    const { t } = await quotaT(opts?.locale)
    return { allowed: false, reason: t('orgNotFound'), plan: 'free', queries: { used: 0, limit: 0 }, tokens: { used: 0, limit: 0 } }
  }

  // A paid plan entitles the org ONLY while its subscription is active/trialing. If it lapsed to
  // past_due / paused / canceled (or the plan column drifted ahead of the status), fall back to FREE
  // limits — otherwise a non-paying org keeps its paid quota AND gets it refreshed every month via
  // the free-window reset branch in maybeResetPeriod (which already treats non-active as non-paid).
  // entitledPlan is the shared rule — the billing page / sidebar display the same downgrade.
  const plan = entitledPlan(org.plan, org.subscription_status)
  const { queries, tokens } = await maybeResetPeriod(admin, orgId, org)

  const qLimit = getPlanLimit(plan, 'queries_per_month')
  const tLimit = getPlanLimit(plan, 'tokens_per_month')

  if (!isUnlimited(qLimit) && queries >= qLimit) {
    if (overageEnabled()) {
      // Don't hard-block a paying customer at the cap — let the run through and bill the excess as
      // overage. The daily abuse cap still bounds runaway usage; the charge happens at renewal (see
      // paddle/overage). +1 because THIS run is the next overage unit.
      const over = computeOverageQueries(plan, queries) + 1
      return {
        allowed: true,
        plan,
        overage: { queries: over, estUsd: overageCostUsd(over) },
        queries: { used: queries, limit: qLimit },
        tokens: { used: tokens, limit: tLimit },
      }
    }
    const { t, num } = await quotaT(opts?.locale)
    return {
      allowed: false,
      reason: t('queryLimitReached', { limit: num(qLimit) }),
      limitType: 'queries',
      plan,
      queries: { used: queries, limit: qLimit },
      tokens: { used: tokens, limit: tLimit },
    }
  }
  if (!isUnlimited(tLimit) && tokens >= tLimit) {
    const { t, num } = await quotaT(opts?.locale)
    return {
      allowed: false,
      reason: t('tokenLimitReached', { limit: num(tLimit) }),
      limitType: 'tokens',
      plan,
      queries: { used: queries, limit: qLimit },
      tokens: { used: tokens, limit: tLimit },
    }
  }
  return { allowed: true, plan, queries: { used: queries, limit: qLimit }, tokens: { used: tokens, limit: tLimit } }
}

async function maybeResetPeriod(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orgId: string,
  org: OrgUsageRow,
): Promise<{ queries: number; tokens: number }> {
  const plan = org.plan ?? 'free'
  const isPaidActive = plan !== 'free' && (org.subscription_status === 'active' || org.subscription_status === 'trialing')
  const used = { queries: org.current_period_query_count ?? 0, tokens: org.current_period_token_count ?? 0 }
  // Paid active subs: the billing window is owned by Paddle. The renewal webhook resets it when
  // webhooks are configured; in webhook-less mode nothing would, so once the stored period has
  // lapsed, reconcile against the Paddle API (a genuine period roll resets the counters, a
  // cancellation drops the plan). Fail-soft: on API failure keep the stale window rather than
  // blocking the run. Runs at most once per org per billing cycle.
  if (isPaidActive) {
    const paidEndsAt = org.current_period_ends_at ? new Date(org.current_period_ends_at).getTime() : 0
    if (paidEndsAt && Date.now() > paidEndsAt) {
      try {
        if (await reconcileOrgSubscription(orgId)) {
          const { data: fresh } = await admin
            .from('organizations')
            .select('current_period_query_count, current_period_token_count')
            .eq('id', orgId)
            .limit(1)
          const row = fresh?.[0] as { current_period_query_count: number | null; current_period_token_count: number | null } | undefined
          if (row) return { queries: row.current_period_query_count ?? 0, tokens: row.current_period_token_count ?? 0 }
        }
      } catch (err) {
        console.error('[billing] paid-period reconcile failed (keeping stored window):', err)
      }
    }
    return used
  }

  const now = Date.now()
  const endsAt = org.current_period_ends_at ? new Date(org.current_period_ends_at).getTime() : 0
  if (org.current_period_ends_at && now < endsAt) return used

  // Window elapsed (or never set) → roll a fresh monthly window. CONDITIONAL on the window still
  // being lapsed at write time: an unconditional overwrite raced concurrent resets/increments (a
  // peer's just-rolled window + its first increment would be clobbered back to 0 → undercount).
  // Postgres re-evaluates the predicate under the row lock, so exactly one resetter wins; the
  // loser re-reads the fresh counters instead of overwriting them.
  const start = new Date(now)
  const end = addMonthsClamped(start, 1)
  let reset = admin
    .from('organizations')
    .update({
      current_period_starts_at: start.toISOString(),
      current_period_ends_at: end.toISOString(),
      current_period_query_count: 0,
      current_period_token_count: 0,
    })
    .eq('id', orgId)
  reset = org.current_period_ends_at
    ? reset.lte('current_period_ends_at', new Date(now).toISOString())
    : reset.is('current_period_ends_at', null)
  const { data: resetRows } = await reset.select('id')
  if (resetRows?.length) return { queries: 0, tokens: 0 }

  // lost the race — a peer already rolled the window; return ITS counters
  const { data: fresh } = await admin
    .from('organizations')
    .select('current_period_query_count, current_period_token_count')
    .eq('id', orgId)
    .limit(1)
  const row = fresh?.[0] as { current_period_query_count: number | null; current_period_token_count: number | null } | undefined
  return { queries: row?.current_period_query_count ?? 0, tokens: row?.current_period_token_count ?? 0 }
}

/**
 * Roll a lapsed usage window WITHOUT running a quota check. The free-plan window only resets
 * lazily inside checkUsageQuota, so a free org that hasn't run a query since its window lapsed
 * would show stale period dates + counts on the billing page — this gives read-only surfaces a
 * way to freshen it. Paid orgs reuse the same lapse-gated reconcile (no-op while current).
 */
export async function ensureFreshPeriod(orgId: string): Promise<void> {
  if (!billingActive()) return
  const admin = createAdminClient()
  if (!admin) return
  const { data, error } = await admin
    .from('organizations')
    .select(
      'plan, subscription_status, current_period_starts_at, current_period_ends_at, current_period_query_count, current_period_token_count',
    )
    .eq('id', orgId)
    .limit(1)
  if (error) return
  const org = data?.[0] as OrgUsageRow | undefined
  if (!org) return
  try {
    await maybeResetPeriod(admin, orgId, org)
  } catch (err) {
    console.error('[billing] ensureFreshPeriod failed (keeping stored window):', err)
  }
}

/** Atomic usage increment via the SECURITY DEFINER RPC (queries and/or tokens). Never throws. */
export async function incrementUsage(orgId: string, queryIncrement: number, tokenIncrement: number): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { error } = await admin.rpc('increment_org_usage', {
    org_id: orgId,
    query_increment: queryIncrement,
    token_increment: tokenIncrement,
  })
  if (error) {
    console.error(`[billing] increment_org_usage failed for ${orgId}:`, error.message)
    // metering LOSS: usage under-counted → the org runs above its paid budget (revenue leak). This is
    // a genuine system fault (not a user-caused/expected failure), so surface it rather than swallow.
    Sentry.captureMessage(`increment_org_usage failed for org ${orgId}: ${error.message}`, 'error')
    return
  }

  // Proactive quota emails: 80% warning (X1) and 100%-reached upgrade (X2), each
  // ONCE per period (own watermark vs current_period_starts_at). Best-effort — a
  // failure here never affects the run that just completed.
  try {
    await maybeSendQuotaWarning(admin, orgId)
    await maybeSendQuotaReached(admin, orgId)
  } catch (err) {
    console.warn(`[billing] quota email check failed for ${orgId}:`, err)
  }
}

async function maybeSendQuotaReached(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orgId: string,
): Promise<void> {
  if (!billingActive()) return
  const { data } = await admin
    .from('organizations')
    .select('name, plan, current_period_query_count, current_period_starts_at, current_period_ends_at, usage_limit_reached_at')
    .eq('id', orgId)
    .limit(1)
  const org = data?.[0] as
    | {
        name: string
        plan: PlanTier | null
        current_period_query_count: number | null
        current_period_starts_at: string | null
        current_period_ends_at: string | null
        usage_limit_reached_at: string | null
      }
    | undefined
  if (!org) return

  const plan = org.plan ?? 'free'
  const limit = getPlanLimit(plan, 'queries_per_month')
  if (isUnlimited(limit)) return
  const used = org.current_period_query_count ?? 0
  if (used < limit) return // not at the cap yet

  // Claim the once-per-period watermark BEFORE sending (atomic conditional update — two runs
  // finishing near-simultaneously are cross-process, so a read-then-send-then-write pattern
  // double-sent). Exactly one process's update matches; only that one sends.
  if (!(await claimEmailWatermark(admin, orgId, 'usage_limit_reached_at', org.usage_limit_reached_at, org.current_period_starts_at))) return

  const [{ recipientsFor }, { sendQuotaReachedEmail }, { resolveOrgLocale }] = await Promise.all([
    import('@/lib/alerts/runner'),
    import('@/lib/email/billing'),
    import('@/lib/i18n/resolve-locale'),
  ])
  await sendQuotaReachedEmail({
    to: await recipientsFor(orgId),
    orgName: org.name,
    plan,
    limit,
    resetsAt: org.current_period_ends_at,
    locale: await resolveOrgLocale(orgId),
  })
}

/**
 * Atomically claim a once-per-period email watermark: set `column` to now() ONLY when it is
 * still unsent for the current period (null, or older than the period start). Returns whether
 * THIS caller won the claim. Cross-process safe — the DB row update is the serialization point.
 */
async function claimEmailWatermark(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orgId: string,
  column: 'usage_warned_at' | 'usage_limit_reached_at',
  currentValue: string | null,
  periodStart: string | null,
): Promise<boolean> {
  // fast path: our snapshot already shows it sent this period
  if (currentValue && (!periodStart || currentValue >= periodStart)) return false
  // Two AND-only conditional updates, NOT one `.or()` filter — PostgREST rejects logical
  // operators on UPDATE (42703; verified against prod 2026-07-16).
  const nowIso = new Date().toISOString()
  const unset = await admin
    .from('organizations')
    .update({ [column]: nowIso })
    .eq('id', orgId)
    .is(column, null)
    .select('id')
  if (unset.error) {
    console.error(`[billing] watermark claim (${column}) failed for ${orgId}:`, unset.error.message)
    return false
  }
  if (unset.data?.length) return true
  if (!periodStart) return false
  // set, but from a PREVIOUS period → claimable for this one
  const rolled = await admin
    .from('organizations')
    .update({ [column]: nowIso })
    .eq('id', orgId)
    .lt(column, periodStart)
    .select('id')
  if (rolled.error) {
    console.error(`[billing] watermark claim (${column}) failed for ${orgId}:`, rolled.error.message)
    return false
  }
  return Boolean(rolled.data?.length)
}

async function maybeSendQuotaWarning(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orgId: string,
): Promise<void> {
  if (!billingActive()) return
  const { data } = await admin
    .from('organizations')
    .select('name, plan, current_period_query_count, current_period_starts_at, usage_warned_at')
    .eq('id', orgId)
    .limit(1)
  const org = data?.[0] as
    | {
        name: string
        plan: PlanTier | null
        current_period_query_count: number | null
        current_period_starts_at: string | null
        usage_warned_at: string | null
      }
    | undefined
  if (!org) return

  const plan = org.plan ?? 'free'
  const limit = getPlanLimit(plan, 'queries_per_month')
  if (isUnlimited(limit)) return
  const used = org.current_period_query_count ?? 0
  if (used < limit * 0.8) return

  // claim-then-send (see claimEmailWatermark) — never double-warn across concurrent runs
  if (!(await claimEmailWatermark(admin, orgId, 'usage_warned_at', org.usage_warned_at, org.current_period_starts_at))) return

  const [{ recipientsFor }, { sendQuotaWarningEmail }, { resolveOrgLocale }] = await Promise.all([
    import('@/lib/alerts/runner'),
    import('@/lib/email/billing'),
    import('@/lib/i18n/resolve-locale'),
  ])
  await sendQuotaWarningEmail({
    to: await recipientsFor(orgId),
    orgName: org.name,
    plan,
    used,
    limit,
    locale: await resolveOrgLocale(orgId),
  })
}

async function getOrgPlan(admin: NonNullable<ReturnType<typeof createAdminClient>>, orgId: string): Promise<string> {
  const { data } = await admin.from('organizations').select('plan').eq('id', orgId).limit(1)
  return (data?.[0] as { plan: string | null } | undefined)?.plan ?? 'free'
}

/** Localized resource-kind labels live under quota.labels.* — call sites pass the KEY. */
export type ResourceLabelKey = 'dataSource' | 'dashboard' | 'widget' | 'alert'

/** Scope of a resource count: which table, which rows, and how to label the cap message. */
export interface ResourceLimitOpts {
  table: string
  label: ResourceLabelKey
  softDelete?: boolean
  filters: Array<{ column: string; value: string }>
  excludeDemo?: boolean
  locale?: string
}

/**
 * How much of a resource cap is left. `limit`/`remaining` are BOTH null when uncapped (billing
 * inactive, no admin client, or an unlimited plan) — never 0, so "no headroom" and "no cap"
 * can't be confused.
 */
export interface ResourceHeadroom {
  limit: number | null
  used: number
  remaining: number | null
}

/** Uncapped: nothing was counted, nothing is denied. */
const UNCAPPED: ResourceHeadroom = { limit: null, used: 0, remaining: null }

/** PURE half of the cap: a plan limit (`-1` = unlimited) + the current count → headroom. */
export function headroomOf(limit: number, used: number): ResourceHeadroom {
  if (isUnlimited(limit)) return { ...UNCAPPED, used }
  return { limit, used, remaining: Math.max(0, limit - used) }
}

/**
 * PURE batch split: how much of `items` fits in the remaining headroom. `remaining === null`
 * (uncapped) takes everything. Used where a single request creates MANY rows at once (the
 * Supabase project picker / connect-time auto-bootstrap), which the one-more-row
 * `enforceResourceLimit` cannot express.
 */
export function withinHeadroom<T>(items: T[], remaining: number | null): { allowed: T[]; skipped: number } {
  if (remaining === null) return { allowed: items, skipped: 0 }
  const allowed = items.slice(0, Math.max(0, remaining))
  return { allowed, skipped: items.length - allowed.length }
}

/**
 * Resource-count cap: how many more of `feature` may this org create? Counts existing rows
 * (service-role client) against the plan cap. Fails OPEN (uncapped) if billing isn't configured.
 * `filters` scopes the count (org_id, or dashboard_id for per-dashboard widget caps).
 */
export async function resourceHeadroom(
  orgId: string,
  feature: keyof PlanLimits,
  opts: ResourceLimitOpts,
): Promise<ResourceHeadroom> {
  if (!billingActive()) return UNCAPPED
  const admin = createAdminClient()
  if (!admin) return UNCAPPED
  const plan = await getOrgPlan(admin, orgId)
  const limit = getPlanLimit(plan, feature)
  if (isUnlimited(limit)) return UNCAPPED
  let q = admin.from(opts.table).select('*', { count: 'exact', head: true })
  for (const f of opts.filters) q = q.eq(f.column, f.value)
  if (opts.softDelete) q = q.is('deleted_at', null)
  if (opts.excludeDemo) q = q.neq('is_demo', true) // the auto-provisioned demo doesn't count against the cap
  const { count } = await q
  return headroomOf(limit, count ?? 0)
}

/** The one localized "cap reached" wording, shared by every surface that reports a resource cap. */
export async function resourceLimitMessage(
  label: ResourceLabelKey,
  limit: number,
  locale?: string,
): Promise<string> {
  const { t, num } = await quotaT(locale)
  return t('resourceLimitReached', { label: t(`labels.${label}`), limit: num(limit) })
}

/** Single-create gate: may this org create ONE more of `feature`? (batch callers use resourceHeadroom) */
export async function enforceResourceLimit(
  orgId: string,
  feature: keyof PlanLimits,
  opts: ResourceLimitOpts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const room = await resourceHeadroom(orgId, feature, opts)
  if (room.limit === null || room.remaining === null || room.remaining > 0) return { ok: true }
  return { ok: false, error: await resourceLimitMessage(opts.label, room.limit, opts.locale) }
}

/** The effective plan cap for `feature`, or null when uncapped (billing inactive, no admin client,
 *  or an unlimited plan). Use for batch inserts where the row-count-based enforceResourceLimit
 *  (which only checks "one more") doesn't fit — e.g. MCP create_dashboard replacing a widget set. */
export async function planLimitFor(orgId: string, feature: keyof PlanLimits): Promise<number | null> {
  if (!billingActive()) return null
  const admin = createAdminClient()
  if (!admin) return null
  const plan = await getOrgPlan(admin, orgId)
  const limit = getPlanLimit(plan, feature)
  return isUnlimited(limit) ? null : limit
}

/** Seat cap: current members + pending invites vs the plan's team_members limit. */
export async function enforceSeatLimit(orgId: string, locale?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!billingActive()) return { ok: true }
  const admin = createAdminClient()
  if (!admin) return { ok: true }
  const plan = await getOrgPlan(admin, orgId)
  const limit = getPlanLimit(plan, 'team_members')
  if (isUnlimited(limit)) return { ok: true }
  const [{ count: members }, { count: invites }] = await Promise.all([
    admin.from('organization_members').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
    // expired invites can't be accepted anymore, so they must not occupy a seat
    // (nothing auto-revokes them — an old invite would otherwise block forever)
    admin
      .from('organization_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString()),
  ])
  const used = (members ?? 0) + (invites ?? 0)
  if (used >= limit) {
    const { t, num } = await quotaT(locale)
    return { ok: false, error: t('seatLimitReached', { limit: num(limit) }) }
  }
  return { ok: true }
}

/**
 * Billing-INDEPENDENT invite rate limit (anti spam-relay). The seat cap above
 * is a no-op until Paddle is configured, which would let one authenticated
 * admin send unlimited invite emails to arbitrary addresses from our verified
 * domain. Mirrors the MAX_RUNS_PER_ORG_PER_DAY pattern in checkUsageQuota:
 * counts invitation ROWS created in the window, so a revoke→re-invite loop
 * (each cycle inserts a fresh row) is counted, not just live pending invites.
 */
export async function enforceInviteRateLimit(
  orgId: string,
  targetEmail: string,
  locale?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: true }

  const dayCap = Number(process.env.MAX_INVITES_PER_ORG_PER_DAY ?? 30)
  if (Number.isFinite(dayCap) && dayCap > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await admin
      .from('organization_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', since)
    if ((count ?? 0) >= dayCap) {
      const { t } = await quotaT(locale)
      return { ok: false, error: t('inviteDailyCap', { cap: dayCap }) }
    }
  }

  // per-target cooldown: repeated re-sends to the same address (invite_member
  // stores lowercased+trimmed emails, so .eq matches what the RPC will insert)
  const perTargetCap = Number(process.env.MAX_INVITES_PER_EMAIL_PER_HOUR ?? 3)
  if (Number.isFinite(perTargetCap) && perTargetCap > 0) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await admin
      .from('organization_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('email', targetEmail.trim().toLowerCase())
      .gte('created_at', since)
    if ((count ?? 0) >= perTargetCap) {
      const { t } = await quotaT(locale)
      return { ok: false, error: t('inviteTargetCooldown') }
    }
  }

  return { ok: true }
}
