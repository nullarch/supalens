// Pure activation-rule logic — no I/O, fully unit-testable (mirrors
// alerts/evaluate.ts). The sweep (sweep.ts) builds a LifecycleContext per org
// from batch DB reads + the org's activation inputs, then calls pickNudge() to
// decide the ONE nudge to send.
//
// The ladder follows the product funnel (TODO.md "Lifecycle Email"):
//   Supabase 연결 → GitHub 연결 → (규칙 승인) → KPI 3개 승인 및 Monitor → Slack 연결 → 첫 Incident
// "첫 Incident 조사 확인" is deliberately NOT a nudge: the incident notification
// itself is that email. Rule verification has no data model yet, so approveKpis
// covers the "review what Supalens understood" step.
//
// NOT `import 'server-only'` — imported by the Trigger.dev sweep. Only pure imports.
import type { LifecycleNudge } from '@/lib/email/lifecycle'
import { computeActivation, type ActivationInputs } from '@/lib/activation/logic'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Past this age an org is activated or churned — churn = dormancy, which we never email. */
export const ONBOARDING_WINDOW_MS = 30 * DAY

/** Product state for one org's owner, as observed by the daily sweep. */
export interface LifecycleContext {
  now: number
  /** organizations.created_at (ms) — accurate signup-of-workspace time. */
  orgCreatedAt: number
  /** has a non-demo, non-deleted, active/pending data source. */
  hasRealSource: boolean
  /** min(created_at) of the real source (ms) — source-stage nudges time off this. */
  firstRealSourceAt: number | null
  /** name of the (first) real source, for the {source} placeholder. */
  firstRealSourceName: string | null
  /**
   * Org activation inputs (activation/state.ts::getActivationInputs). null when the
   * sweep skipped them — it only pays for them once a real source exists.
   */
  activation: ActivationInputs | null
}

export interface NudgeDecision {
  nudge: LifecycleNudge
  /** stable ledger key — one-shot, so = kind (sendable exactly once, ever). */
  kind: string
  dedupeKey: string
  sourceName?: string
}

function within(age: number, lower: number, upper = ONBOARDING_WINDOW_MS): boolean {
  return age >= lower && age <= upper
}

/**
 * The activation ladder, highest-stage first. A user is in at most one state, so
 * the first match wins. Each window has a LOWER bound (give them a beat to act on
 * their own) and an UPPER bound (past it they're activated or churned). Bounding the
 * upper edge also stops the first cron run from blasting the back-catalog of old signups.
 */
export function pickNudge(ctx: LifecycleContext): NudgeDecision | null {
  const orgAge = ctx.now - ctx.orgCreatedAt
  const sourceAge = ctx.firstRealSourceAt != null ? ctx.now - ctx.firstRealSourceAt : null
  const sourceName = ctx.firstRealSourceName ?? undefined

  if (ctx.hasRealSource) {
    if (!ctx.activation || sourceAge == null) return null
    const a = computeActivation(ctx.activation)
    const s = a.steps
    if (!s.db_connected) return null // pending-only source — nothing for the user to do yet

    // L4 · connectSlack — monitoring is live, but only email will hear it
    if (s.kpis_approved && s.monitors_active && !a.slackConnected && sourceAge >= 24 * HOUR && within(orgAge, 0)) {
      return { nudge: 'connectSlack', kind: 'activate_connect_slack', dedupeKey: 'activate_connect_slack' }
    }
    // L3 · approveKpis — understanding exists; fewer than 3 approved KPIs or 3 monitors
    if (
      s.repo_attached &&
      s.understanding_generated &&
      (!s.kpis_approved || !s.monitors_active) &&
      within(sourceAge, 48 * HOUR)
    ) {
      return { nudge: 'approveKpis', kind: 'activate_approve_kpis', dedupeKey: 'activate_approve_kpis', sourceName }
    }
    // L2 · connectRepo — a real DB, no code yet
    if (!s.repo_attached && within(sourceAge, 24 * HOUR)) {
      return { nudge: 'connectRepo', kind: 'activate_connect_repo', dedupeKey: 'activate_connect_repo', sourceName }
    }
    // repo attached but understanding not generated yet (generating/failed) → the system's move, not theirs
    return null
  }

  // L1 · connectSource — signed up, no own data yet
  if (within(orgAge, 24 * HOUR)) {
    return { nudge: 'connectSource', kind: 'activate_connect_source', dedupeKey: 'activate_connect_source' }
  }
  return null
}
