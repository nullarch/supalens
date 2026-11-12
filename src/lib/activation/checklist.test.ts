import { describe, expect, it } from "vitest";

import {
  checklistHidden,
  checklistHideKey,
  checklistItems,
  checklistProgress,
  checklistSignature,
  showChecklist,
} from "./checklist";
import {
  ACTIVATION_MIN_KPIS,
  ACTIVATION_MIN_MONITORS,
  OPTIONAL_ACTIVATION_STEPS,
  REQUIRED_ACTIVATION_STEPS,
  computeActivation,
  type ActivationInputs,
} from "./logic";

const empty: ActivationInputs = {
  realActiveSources: 0,
  reposAttached: 0,
  contextsGenerated: 0,
  kpisProposed: 0,
  kpisAccepted: 0,
  monitorsEnabled: 0,
  slackConnected: false,
  alertChannelConfigured: false,
};
/** Every required step done, both recommendations skipped. */
const activated: ActivationInputs = {
  ...empty,
  realActiveSources: 1,
  contextsGenerated: 1,
  kpisProposed: 8,
  kpisAccepted: ACTIVATION_MIN_KPIS,
  monitorsEnabled: ACTIVATION_MIN_MONITORS,
};
const half: ActivationInputs = { ...empty, realActiveSources: 1, contextsGenerated: 1 };

describe("checklistItems", () => {
  it("lists every required step (done ones included) then the open recommendations", () => {
    const items = checklistItems(computeActivation(half));
    expect(items.filter((i) => !i.optional).map((i) => i.step)).toEqual(REQUIRED_ACTIVATION_STEPS);
    expect(items.filter((i) => i.optional).map((i) => i.step)).toEqual([...OPTIONAL_ACTIVATION_STEPS]);
    expect(items.find((i) => i.step === "db_connected")).toMatchObject({ done: true, current: false });
    expect(items.find((i) => i.step === "kpis_extracted")).toMatchObject({ done: false, current: true });
  });

  it("PIN: an optional row is never `current` — nothing is ever told to do one next", () => {
    for (const inputs of [empty, half, activated, { ...activated, reposAttached: 1 }]) {
      const items = checklistItems(computeActivation(inputs));
      expect(items.filter((i) => i.optional && i.current)).toEqual([]);
      expect(items.filter((i) => i.current).length).toBeLessThanOrEqual(1);
    }
  });

  it("drops a recommendation once it is done instead of adding a ✓ the counter doesn't count", () => {
    const items = checklistItems(computeActivation({ ...half, reposAttached: 1 }));
    expect(items.map((i) => i.step)).not.toContain("repo_attached");
    expect(items.filter((i) => i.optional).map((i) => i.step)).toEqual(["notifications_configured"]);
  });

  it("progress is over required steps only, so it can always reach the total", () => {
    expect(checklistProgress(computeActivation(empty))).toEqual({ done: 0, total: REQUIRED_ACTIVATION_STEPS.length });
    const done = checklistProgress(computeActivation(activated));
    expect(done.done).toBe(done.total);
  });
});

describe("showChecklist", () => {
  it("is server state alone: gone once activated, back the moment it regresses", () => {
    expect(showChecklist(computeActivation(empty))).toBe(true);
    expect(showChecklist(computeActivation(half))).toBe(true);
    expect(showChecklist(computeActivation(activated))).toBe(false);
    // a monitor being turned off is a regression — the guide returns
    expect(showChecklist(computeActivation({ ...activated, monitorsEnabled: 1 }))).toBe(true);
  });

  it("skipping both recommendations still completes (they never hold it open)", () => {
    expect(showChecklist(computeActivation(activated))).toBe(false);
  });
});

describe("the per-browser hide is a snooze, not a one-shot", () => {
  it("only hides the exact state it hid", () => {
    const state = computeActivation(half);
    expect(checklistHidden(checklistSignature(state), state)).toBe(true);
    expect(checklistHidden(null, state)).toBe(false);
    expect(checklistHidden("", state)).toBe(false);
  });

  it("a stored hide stops matching when any step flips, forward OR backward", () => {
    const stored = checklistSignature(computeActivation(half));
    expect(checklistHidden(stored, computeActivation({ ...half, kpisProposed: 5 }))).toBe(false);
    expect(checklistHidden(stored, computeActivation({ ...half, contextsGenerated: 0 }))).toBe(false);
    // an optional step counts too: it is part of the state the user chose to hide
    expect(checklistHidden(stored, computeActivation({ ...half, reposAttached: 1 }))).toBe(false);
  });

  it("is scoped per workspace", () => {
    expect(checklistHideKey("org-a")).not.toBe(checklistHideKey("org-b"));
    expect(checklistHideKey("org-a")).toContain("org-a");
  });
});
