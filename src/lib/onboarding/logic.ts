// Pure decision logic for the first-login onboarding wizard. No io — pin-tested in logic.test.ts.

export type WizardMode = 'full' | 'tour'
/** 1 replay · 2 connect a DB · 3 attach the code (only when a DB exists) · 4 KPI proposal. */
export type WizardAct = 1 | 2 | 3 | 4
export const WIZARD_TOTAL_STEPS = 4

/**
 * Show the wizard only to users who have never COMPLETED it AND have never run an analysis. The
 * run guard covers stragglers the migration backfill can't see (e.g. a profile row created between
 * deploy and backfill): anyone with activity is never interrupted. A dismissal (✕ / ESC / skip) is
 * NOT a completion — it is remembered per browser (see `wizardDismissKey`) so the overlay doesn't
 * nag, while the home checklist (app/overview/SetupChecklist) keeps offering the remaining steps.
 */
export function shouldShowWizard(args: { wizardCompletedAt: string | null; runCount: number }): boolean {
  return args.wizardCompletedAt == null && args.runCount === 0
}

/**
 * Is this viewer's onboarding already owned by the home checklist?
 *
 * True for an owner/admin (the roles that can connect a database) of a workspace with zero
 * real (non-demo) data sources: /app/overview shows them the one activation checklist, so the
 * tour overlay must stay out of their way. An unknown count (the read failed) is not a claim.
 *
 * There is no onboarding MODAL any more — this used to gate one, and two overlays suppressing
 * each other is how a half-connected workspace ended up with no guide at all.
 */
export function homeChecklistCoversOnboarding(args: { role: string | null | undefined; realSourceCount: number | null | undefined }): boolean {
  return (args.role === 'owner' || args.role === 'admin') && args.realSourceCount === 0
}

/** localStorage key for the per-workspace, per-browser dismissal of the onboarding modal
 *  (the modal itself is now a /dev preview only — see src/app/dev/onboarding-modal). */
export function onboardingModalDismissKey(orgId: string): string {
  return `supalens.onboardingModal.dismissed.${orgId}`
}

/** The routes the modal hands off to — it never covers the connect surfaces themselves. */
export const ONBOARDING_MODAL_HIDDEN_ROUTES = ['/app/setup', '/app/sources'] as const

export function onboardingModalAllowedOn(pathname: string): boolean {
  return !ONBOARDING_MODAL_HIDDEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

/** The modal's connect step → the real connection flow for the chosen database. Supabase goes
 *  through OAuth and resumes on /app/setup (project picker → scan → KPIs → alerts); the others
 *  open their connection form on /app/sources. */
export function onboardingConnectHref(source: 'supabase' | 'postgresql' | 'mysql' | 'firestore'): string {
  if (source === 'supabase') return '/api/connect-supabase/authorize?returnTo=/app/setup'
  return `/app/sources?connect=${source === 'postgresql' ? 'postgres' : source}`
}

/** localStorage key for the per-user, per-browser dismissal. */
export function wizardDismissKey(userId: string): string {
  return `supalens.wizard.dismissed.${userId}`
}

/**
 * Which exits COMPLETE the wizard (durable `wizard_completed_at` stamp) vs merely DISMISS it.
 * Only finishing the last act completes: starting a real extraction, or the invitee tour's
 * "get started". Everything else (✕, ESC, skips, "later", browsing the sample) is a dismissal —
 * the product-activation state is tracked separately from this tutorial flag.
 */
export function exitCompletes(reason: string): boolean {
  return reason === 'extract_started' || reason === 'tour_done'
}

/**
 * Users joining an org that already has real (non-demo) sources get the short tour (Act 1 +
 * epilogue only) — we never ask an invitee to connect a database to someone else's org.
 */
export function wizardMode(args: { hasRealSources: boolean }): WizardMode {
  return args.hasRealSources ? 'tour' : 'full'
}

/**
 * Which act to open at. `resume` = returning from the Supabase OAuth round-trip
 * (`?wizard=resume` carried through the authorize route's returnTo). Skips are always forward:
 * a resumed session lands past Act 1 — on the code step when the connection actually got made.
 */
export function initialAct(args: { resume: boolean; hasRealSources: boolean }): WizardAct {
  if (!args.resume) return 1
  return args.hasRealSources ? 3 : 2
}

/** Leaving Act 2: the code step only makes sense when there is a DB to attach code to. */
export function actAfterConnect(args: { hasRealSources: boolean }): WizardAct {
  return args.hasRealSources ? 3 : 4
}

/** Act 4 shape: connected → propose a real extraction; skipped → show the sample catalog. */
export function kpiActVariant(args: { hasRealSources: boolean }): 'extract' | 'sample' {
  return args.hasRealSources ? 'extract' : 'sample'
}

/* `pillSteps` lived here as dead code stating the invariant the shipped code violated. The
   invariant now lives where it is enforced: `OPTIONAL_ACTIVATION_STEPS` in lib/activation/logic
   (never `nextStep`, never blocks `completed`) and `checklistItems` in lib/activation/checklist. */
