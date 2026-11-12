import { describe, expect, it } from "vitest";

import {
  ACTIVATION_MIN_KPIS,
  ACTIVATION_MIN_MONITORS,
  ACTIVATION_STEPS,
  OPTIONAL_ACTIVATION_STEPS,
  REQUIRED_ACTIVATION_STEPS,
  computeActivation,
  isOptionalStep,
  homeMode,
  isMissingSchemaError,
  minutesSince,
  nextCheckInMinutes,
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

const full: ActivationInputs = {
  realActiveSources: 1,
  reposAttached: 1,
  contextsGenerated: 1,
  kpisProposed: 7,
  kpisAccepted: ACTIVATION_MIN_KPIS,
  monitorsEnabled: ACTIVATION_MIN_MONITORS,
  slackConnected: false,
  alertChannelConfigured: false,
};

describe("computeActivation", () => {
  it("a fresh org has nothing done and db_connected is next", () => {
    const a = computeActivation(empty);
    expect(a.completed).toBe(false);
    expect(a.nextStep).toBe("db_connected");
    expect(a.progress).toBe(0);
  });

  it("walks the funnel in order — understanding before KPIs before monitors", () => {
    expect(computeActivation({ ...empty, realActiveSources: 1 }).nextStep).toBe(
      "understanding_generated",
    );
    expect(
      computeActivation({
        ...empty,
        realActiveSources: 1,
        contextsGenerated: 1,
      }).nextStep,
    ).toBe("kpis_extracted");
    expect(
      computeActivation({ ...full, kpisAccepted: ACTIVATION_MIN_KPIS - 1 })
        .nextStep,
    ).toBe("kpis_approved");
    expect(
      computeActivation({
        ...full,
        monitorsEnabled: ACTIVATION_MIN_MONITORS - 1,
      }).nextStep,
    ).toBe("monitors_active");
  });

  it("completes with email-only delivery — Slack is recommended, never required", () => {
    const a = computeActivation(full);
    expect(a.completed).toBe(true);
    expect(a.nextStep).toBeNull();
    expect(a.slackConnected).toBe(false);
  });

  it("notifications_configured comes from an actual channel row, never a constant", () => {
    // It used to be hardcoded `true`: a ✓ for work nobody did, and the step's own UI was dead.
    expect(computeActivation(full).steps.notifications_configured).toBe(false);
    expect(
      computeActivation({ ...full, alertChannelConfigured: true }).steps
        .notifications_configured,
    ).toBe(true);
    // a connected Slack WORKSPACE with no channel chosen is not a configured destination
    expect(
      computeActivation({ ...full, slackConnected: true }).steps
        .notifications_configured,
    ).toBe(false);
  });

  it("a KPI proposal row alone is NOT approval (the old hasKpis bug)", () => {
    const a = computeActivation({ ...full, kpisAccepted: 0 });
    expect(a.steps.kpis_extracted).toBe(true);
    expect(a.steps.kpis_approved).toBe(false);
    expect(a.completed).toBe(false);
  });

  it("demo-only orgs count as unconnected (inputs exclude demo sources by contract)", () => {
    expect(
      computeActivation({ ...empty, kpisProposed: 10 }).steps.db_connected,
    ).toBe(false);
  });
});

describe("PIN: an optional step never gates activation", () => {
  const optional = [...OPTIONAL_ACTIVATION_STEPS];
  /** Every REQUIRED step done, every OPTIONAL one skipped — the org that could never finish. */
  const requiredOnly: ActivationInputs = { ...full, reposAttached: 0, alertChannelConfigured: false };

  it("the two sets partition the funnel and every optional step is marked as one", () => {
    expect([...REQUIRED_ACTIVATION_STEPS, ...optional].sort()).toEqual(
      [...ACTIVATION_STEPS].sort(),
    );
    expect(optional.every(isOptionalStep)).toBe(true);
    expect(REQUIRED_ACTIVATION_STEPS.some(isOptionalStep)).toBe(false);
  });

  it("is never handed over as nextStep, at any point in the funnel", () => {
    // every reachable prefix of the funnel — the shipped bug was `repo_attached` becoming
    // nextStep for an org without GitHub, which rendered a card with no way to continue.
    const stages: ActivationInputs[] = [
      empty,
      { ...empty, realActiveSources: 1 },
      { ...empty, realActiveSources: 1, contextsGenerated: 1 },
      { ...empty, realActiveSources: 1, contextsGenerated: 1, kpisProposed: 4 },
      { ...full, kpisAccepted: ACTIVATION_MIN_KPIS - 1 },
      { ...full, monitorsEnabled: ACTIVATION_MIN_MONITORS - 1 },
      full,
    ];
    for (const inputs of stages) {
      const next = computeActivation(inputs).nextStep;
      expect(next === null || !isOptionalStep(next)).toBe(true);
    }
  });

  it("never blocks completion, and never inflates progress", () => {
    const a = computeActivation(requiredOnly);
    for (const step of optional) expect(a.steps[step]).toBe(false);
    expect(a.completed).toBe(true);
    expect(a.progress).toBe(1);
    // doing an optional step cannot push progress past 1 either
    expect(
      computeActivation({ ...full, reposAttached: 1, alertChannelConfigured: true })
        .progress,
    ).toBe(1);
  });

  it("is offered as a suggestion while incomplete, and drops off once done", () => {
    expect(computeActivation(requiredOnly).suggestions).toEqual(optional);
    expect(
      computeActivation({ ...requiredOnly, reposAttached: 1 }).suggestions,
    ).toEqual(["notifications_configured"]);
    expect(
      computeActivation({ ...requiredOnly, reposAttached: 1, alertChannelConfigured: true })
        .suggestions,
    ).toEqual([]);
  });
});

describe("homeMode", () => {
  it("setup until activated, then incident > healthy", () => {
    expect(homeMode(computeActivation(empty), 0)).toBe("setup");
    const done = computeActivation(full);
    expect(homeMode(done, 2)).toBe("incident");
    expect(homeMode(done, 0)).toBe("healthy");
  });

  it("an activated org always has monitors, so there is no zero-monitor mode", () => {
    // completed requires ACTIVATION_MIN_MONITORS enabled monitors — the old 'empty'
    // branch was unreachable, and re-adding one would need this invariant to change.
    expect(computeActivation(full).counts.monitorsEnabled).toBeGreaterThanOrEqual(
      ACTIVATION_MIN_MONITORS,
    );
  });
});

describe("isMissingSchemaError", () => {
  it("is true ONLY for undefined table/column — the deploy-before-migration case", () => {
    expect(isMissingSchemaError({ code: "42703" })).toBe(true); // undefined_column
    expect(isMissingSchemaError({ code: "42P01" })).toBe(true); // undefined_table
  });

  it("is false for every other fault, so those must not read as 'step not done'", () => {
    expect(isMissingSchemaError({ code: "42501" })).toBe(false); // insufficient_privilege
    expect(isMissingSchemaError({ code: "57014" })).toBe(false); // query_canceled
    expect(isMissingSchemaError({ message: "fetch failed" })).toBe(false);
    expect(isMissingSchemaError(new Error("boom"))).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
    expect(isMissingSchemaError("42703")).toBe(false);
  });
});

describe('check timing helpers', () => {
  const now = Date.parse('2026-09-04T10:00:00Z')
  const ago = (sec: number) => new Date(now - sec * 1000).toISOString()
  it('nextCheckInMinutes counts down from the plan interval and floors at 0', () => {
    expect(nextCheckInMinutes(null, 300, now)).toBe(0)
    expect(nextCheckInMinutes(ago(60), 300, now)).toBe(4)
    expect(nextCheckInMinutes(ago(600), 300, now)).toBe(0)
    expect(nextCheckInMinutes(ago(0), 7200, now)).toBe(120)
  })
  it('minutesSince is whole minutes, null-safe', () => {
    expect(minutesSince(null, now)).toBeNull()
    expect(minutesSince(ago(90), now)).toBe(1)
    expect(minutesSince('garbage', now)).toBeNull()
  })
})
