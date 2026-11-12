/**
 * Activation state — PURE decision logic (no io, no React, no server imports).
 *
 * "Activation" is the ORG-level product state from the strategy doc: a workspace is
 * activated when Supalens is actually watching a real business, not when a user has
 * closed the tutorial. This replaces `profiles.wizard_completed_at` as the funnel
 * signal — that column stays a per-USER "seen the tour" flag only.
 *
 * Completion (v1) — mirrors TODO.md "정확한 Activation 상태 모델":
 *   real active source >= 1
 *   repo attached
 *   understanding (SUPALENS.md) generated at least once
 *   accepted KPIs >= ACTIVATION_MIN_KPIS
 *   enabled monitors >= ACTIVATION_MIN_MONITORS
 *
 * Two steps are RECOMMENDED, not required (`OPTIONAL_ACTIVATION_STEPS`): attaching a repo,
 * and routing alerts to a chat channel. Email delivery to owner/admin verified addresses
 * always exists, so neither can ever be the thing blocking a workspace. They are SUGGESTED
 * (see `ActivationState.suggestions`) and never become `nextStep` — counting an optional
 * step is exactly the never-completable-checklist bug.
 *
 * `business_rules_verified` is deliberately NOT a step yet: there is no structured
 * rule-approval model to verify against. Add it here (and only here) when that lands.
 */

export type ActivationInputs = {
  /** Active, non-demo, non-deleted data sources. */
  realActiveSources: number;
  /** Real sources with a repo attached. */
  reposAttached: number;
  /** Real sources whose SUPALENS.md context has been generated (fresh or stale). */
  contextsGenerated: number;
  /** KPI catalog rows on real sources (any status). */
  kpisProposed: number;
  /** KPI catalog rows on real sources with status 'accepted'. */
  kpisAccepted: number;
  /** Enabled, non-deleted alerts on real sources. */
  monitorsEnabled: number;
  /** An active Slack workspace connection exists. */
  slackConnected: boolean;
  /** An enabled Slack/Discord notification channel (or legacy Slack webhook) exists. */
  alertChannelConfigured: boolean;
};

export const ACTIVATION_STEPS = [
  "db_connected",
  "repo_attached",
  "understanding_generated",
  "kpis_extracted",
  "kpis_approved",
  "monitors_active",
  "notifications_configured",
] as const;

export type ActivationStep = (typeof ACTIVATION_STEPS)[number];

/**
 * Steps a workspace is NEVER blocked on. An optional step may be shown as a suggestion, but
 * it must never be `nextStep` and must never keep `completed` false — a checklist that counts
 * a step nobody is required to take can never be finished (the shipped bug this replaces).
 */
export const OPTIONAL_ACTIVATION_STEPS = [
  "repo_attached",
  "notifications_configured",
] as const satisfies ReadonlyArray<ActivationStep>;

export type OptionalActivationStep = (typeof OPTIONAL_ACTIVATION_STEPS)[number];

export function isOptionalStep(step: ActivationStep): boolean {
  return (OPTIONAL_ACTIVATION_STEPS as readonly string[]).includes(step);
}

/** The steps that actually gate activation, in funnel order. */
export const REQUIRED_ACTIVATION_STEPS: ActivationStep[] = ACTIVATION_STEPS.filter(
  (s) => !isOptionalStep(s),
);

export const ACTIVATION_MIN_KPIS = 3;
export const ACTIVATION_MIN_MONITORS = 3;

export type ActivationState = {
  steps: Record<ActivationStep, boolean>;
  /** First incomplete REQUIRED step in funnel order; null when completed. */
  nextStep: ActivationStep | null;
  completed: boolean;
  /** 0..1, completed required steps / required total — for progress UI only. */
  progress: number;
  /** Incomplete OPTIONAL steps, funnel order — offered, never blocking. */
  suggestions: ActivationStep[];
  /** Optional-but-recommended flags surfaced by setup/overview UI. */
  slackConnected: boolean;
  counts: Pick<
    ActivationInputs,
    "kpisAccepted" | "monitorsEnabled" | "realActiveSources"
  >;
};

export function computeActivation(i: ActivationInputs): ActivationState {
  const steps: Record<ActivationStep, boolean> = {
    db_connected: i.realActiveSources >= 1,
    repo_attached: i.reposAttached >= 1,
    understanding_generated: i.contextsGenerated >= 1,
    kpis_extracted: i.kpisProposed >= 1,
    kpis_approved: i.kpisAccepted >= ACTIVATION_MIN_KPIS,
    monitors_active: i.monitorsEnabled >= ACTIVATION_MIN_MONITORS,
    // "Done" means an actual delivery channel row exists — a bot channel, a Discord/Slack
    // webhook. It used to be hardcoded true, which rendered a ✓ for work nobody did and made
    // the step's own UI unreachable. Email delivery still always exists, which is why the step
    // is OPTIONAL rather than required: honest ✓, and still never a blocker.
    notifications_configured: i.alertChannelConfigured,
  };
  const nextStep = REQUIRED_ACTIVATION_STEPS.find((s) => !steps[s]) ?? null;
  const done = REQUIRED_ACTIVATION_STEPS.filter((s) => steps[s]).length;
  return {
    steps,
    nextStep,
    completed: nextStep === null,
    progress: done / REQUIRED_ACTIVATION_STEPS.length,
    suggestions: ACTIVATION_STEPS.filter((s) => isOptionalStep(s) && !steps[s]),
    slackConnected: i.slackConnected || i.alertChannelConfigured,
    counts: {
      kpisAccepted: i.kpisAccepted,
      monitorsEnabled: i.monitorsEnabled,
      realActiveSources: i.realActiveSources,
    },
  };
}

/**
 * Which surface the app home should show.
 *   'setup'     — activation incomplete
 *   'incident'  — at least one monitor is firing
 *   'healthy'   — activated, nothing firing
 *
 * There is deliberately no 'empty' mode: `completed` already requires
 * ACTIVATION_MIN_MONITORS enabled monitors on real sources, so an activated org
 * always has monitors. The board's own states (a failing check, a paused monitor)
 * carry the "nothing is being evaluated" case instead.
 */
export type HomeMode = "setup" | "incident" | "healthy";

export function homeMode(a: ActivationState, firing: number): HomeMode {
  if (!a.completed) return "setup";
  if (firing > 0) return "incident";
  return "healthy";
}

/**
 * Is this a "the migration hasn't run yet" Postgres error?
 *
 * `42703` undefined_column / `42P01` undefined_table are the only read failures the
 * activation counts may treat as "0" — they mean the code shipped ahead of its
 * migration, which must degrade rather than break the page. Every OTHER error (a
 * transient fault, a broken policy) must propagate: silently reading it as "step not
 * done" is what makes the lifecycle sweep send a false nudge and burn its one-shot
 * dedupe key.
 */
export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === "42703" || code === "42P01";
}

/**
 * Minutes until the next scheduled check for a monitor, given the plan's effective interval.
 * null lastCheckedAt → 0 (it is due on the next tick). Never negative.
 */
export function nextCheckInMinutes(lastCheckedAt: string | null, intervalSec: number, nowMs: number): number {
  if (!lastCheckedAt) return 0
  const last = Date.parse(lastCheckedAt)
  if (Number.isNaN(last)) return 0
  const dueMs = last + intervalSec * 1000
  return Math.max(0, Math.ceil((dueMs - nowMs) / 60_000))
}

/** Whole minutes since an ISO timestamp (null → null). */
export function minutesSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((nowMs - t) / 60_000))
}
