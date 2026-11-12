/**
 * Home-screen onboarding checklist — PURE presentation logic (no io, no React).
 *
 * There is exactly ONE onboarding surface: a compact, non-blocking checklist on the home
 * screen (/app/overview). It is derived from org activation state, so it can never disagree
 * with what the product is actually doing, and it disappears the moment the workspace is
 * activated. /app/setup remains the "details" destination (deep links + OAuth returnTo),
 * never a gate.
 *
 * Two rules this module exists to keep:
 *   1. An OPTIONAL step is a suggestion. It is listed only while incomplete, is marked
 *      secondary, and never appears as `current` — so it can never be the thing a user is
 *      told to do next, and can never hold the checklist open.
 *   2. Hiding is per browser AND keyed to the state it was hiding. `checklistSignature`
 *      changes whenever any step flips, so a hidden checklist comes back on the next change
 *      in either direction (progress made, or state regressed).
 */
import {
  ACTIVATION_STEPS,
  REQUIRED_ACTIVATION_STEPS,
  isOptionalStep,
  type ActivationState,
  type ActivationStep,
} from "./logic";

export type ChecklistItem = {
  step: ActivationStep;
  done: boolean;
  /** The one required step to do next. NEVER true for an optional step. */
  current: boolean;
  /** Recommended, not required — rendered secondary. */
  optional: boolean;
};

/**
 * The rows the checklist shows: every REQUIRED step (done ones included, so progress reads
 * honestly), then the incomplete recommendations.
 *
 * A COMPLETED optional step is deliberately dropped instead of rendering a ✓: it never
 * counted toward the progress figure, so leaving it on the list would show more checks than
 * the counter admits.
 */
export function checklistItems(a: ActivationState): ChecklistItem[] {
  const required = REQUIRED_ACTIVATION_STEPS.map((step) => ({
    step,
    done: a.steps[step],
    current: a.nextStep === step,
    optional: false,
  }));
  const suggested = ACTIVATION_STEPS.filter(
    (step) => isOptionalStep(step) && !a.steps[step],
  ).map((step) => ({ step, done: false, current: false, optional: true }));
  return [...required, ...suggested];
}

/** Completed required steps / required total — what the checklist's counter reports. */
export function checklistProgress(a: ActivationState): { done: number; total: number } {
  return {
    done: REQUIRED_ACTIVATION_STEPS.filter((s) => a.steps[s]).length,
    total: REQUIRED_ACTIVATION_STEPS.length,
  };
}

/**
 * Show the checklist at all? Server state alone decides — an activated workspace never sees
 * it, and a regression brings it straight back. (The per-browser hide below is a second,
 * subordinate filter, never the only mechanism.)
 */
export function showChecklist(a: ActivationState): boolean {
  return !a.completed;
}

/** localStorage key for the per-workspace, per-browser hide. */
export function checklistHideKey(orgId: string): string {
  return `supalens.setupChecklist.hidden.${orgId}`;
}

/**
 * The state a hide applies to. Any step flipping (forward OR backward) changes it, so a
 * stored hide stops matching and the checklist returns — there is no permanent one-shot.
 */
export function checklistSignature(a: ActivationState): string {
  return ACTIVATION_STEPS.map((step) => (a.steps[step] ? "1" : "0")).join("");
}

/** Hidden only when this browser hid THIS exact state. */
export function checklistHidden(stored: string | null, a: ActivationState): boolean {
  return stored !== null && stored === checklistSignature(a);
}
