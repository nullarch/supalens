// NOT `import 'server-only'` — pure decision logic (no io), shared by the BFF routes, the GitHub
// webhook, and (transitively) the Trigger runtime. Mirrors the alerts split: policy.ts decides,
// service.ts/routes do the io.
//
// Plan policy for tier-2 (repo-based, LLM) context extraction — see lib/plans/limits.ts for the
// numbers: free = one lifetime extraction per org (spent by the attach auto-run); paid = unlimited
// manual; push-triggered auto-regen only on plans with a non-zero cooldown (standard/premium).
import { getPlanLimits, isUnlimited, type PlanTier } from '@/lib/plans/limits'

/**
 * May this org start another tier-2 extraction (manual POST or attach auto-run)?
 * `extractionsUsed` counts SUCCESSFUL generations only (failed runs never consume the free slot).
 * Callers gate enforcement on billingActive() — pre-billing, capping would strand users.
 */
export function canExtractContext(plan: PlanTier, extractionsUsed: number): boolean {
  const limit = getPlanLimits(plan).context_extractions_total
  if (isUnlimited(limit)) return true
  return extractionsUsed < limit
}

/**
 * Should a push to the attached repo auto-regenerate the context doc, or only mark it stale?
 * Cooldown counts from the last SUCCESSFUL generation (`generated_at`); a source that has never
 * generated (or whose timestamp is unparseable) is regen-eligible on cooldown-enabled plans.
 * Deliberately billing-INDEPENDENT (a cost/abuse guard, like MAX_RUNS_PER_ORG_PER_DAY): with no
 * Paddle configured every org resolves to free ⇒ push auto-regen stays off outside prod.
 */
export function shouldAutoRegenContext(
  plan: PlanTier,
  lastGeneratedAt: string | Date | null,
  now: Date,
): boolean {
  const cooldownHours = getPlanLimits(plan).context_auto_regen_cooldown_hours
  if (cooldownHours <= 0) return false
  if (!lastGeneratedAt) return true
  const last = typeof lastGeneratedAt === 'string' ? new Date(lastGeneratedAt) : lastGeneratedAt
  if (Number.isNaN(last.getTime())) return true
  return now.getTime() - last.getTime() >= cooldownHours * 3_600_000
}
