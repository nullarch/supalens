import { describe, expect, it } from "vitest";
import { overviewStage, serviceStage, type OverviewStageInputs } from "./overview-stage";

const base: OverviewStageInputs = {
  realSources: 1,
  connectionPending: false,
  scan: { context: "done", kpi: "done" },
  pendingProposals: 0,
  monitorsTotal: 0,
  monitorsEnabled: 0,
  monitorsChecked: 0,
  firing: 0,
  errored: 0,
  connectionErrors: 0,
};
const stage = (over: Partial<OverviewStageInputs>) => overviewStage({ ...base, ...over });

describe("overviewStage", () => {
  it("no real source is new, even with a pending Supabase authorization", () => {
    expect(stage({ realSources: 0, scan: null }).stage).toBe("new");
    expect(stage({ realSources: 0, scan: null, connectionPending: true }).stage).toBe("new");
  });

  it("a running scan wins over proposals while nothing is watched", () => {
    expect(stage({ scan: { context: "running", kpi: "pending" }, pendingProposals: 4 }).stage).toBe("analyzing");
    expect(stage({ scan: { context: "done", kpi: "running" } }).stage).toBe("analyzing");
  });

  it("proposals, then extract when there is nothing to review", () => {
    expect(stage({ pendingProposals: 3 }).stage).toBe("proposals");
    expect(stage({ pendingProposals: 0 }).stage).toBe("extract");
  });

  it("one enabled monitor is enough to leave setup — no repo, Slack or 3 KPIs required", () => {
    expect(stage({ monitorsTotal: 1, monitorsEnabled: 1 }).stage).toBe("first_check");
    expect(stage({ monitorsTotal: 1, monitorsEnabled: 1, monitorsChecked: 1 }).stage).toBe("operating");
  });

  it("switching every monitor off pauses the board instead of returning to setup", () => {
    const r = stage({ monitorsTotal: 4, monitorsEnabled: 0, pendingProposals: 9 });
    expect(r.stage).toBe("paused");
  });

  it("board priority: firing > degraded > pending > normal", () => {
    const on = { monitorsTotal: 3, monitorsEnabled: 3, monitorsChecked: 3 };
    expect(stage({ ...on, firing: 1, errored: 2 }).board).toBe("firing");
    expect(stage({ ...on, errored: 1 }).board).toBe("degraded");
    expect(stage({ ...on, monitorsChecked: 2 }).board).toBe("pending");
    expect(stage(on).board).toBe("normal");
  });

  it("recovery: a broken connection overrides any stage; a failed scan only before watching", () => {
    expect(stage({ monitorsTotal: 2, monitorsEnabled: 2, monitorsChecked: 2, errored: 2, connectionErrors: 2 }).recovery).toBe("reconnect");
    expect(stage({ scan: { context: "failed", kpi: "pending" } }).recovery).toBe("scan_failed");
    expect(stage({ scan: { context: "done", kpi: "failed" }, monitorsTotal: 1, monitorsEnabled: 1 }).recovery).toBeNull();
    expect(stage({ realSources: 0, scan: null }).recovery).toBeNull();
  });
});

describe("serviceStage", () => {
  const base = { scan: null, pendingProposals: 0, monitorsTotal: 0, monitorsEnabled: 0, monitorsChecked: 0, firing: 0, errored: 0, connectionErrors: 0 };

  it("a real source is never 'new' — with nothing on it, the next step is extraction", () => {
    expect(serviceStage(base)).toEqual({ stage: "extract", board: "normal", recovery: null });
  });

  it("matches the org-level decision for the same single-source inputs", () => {
    const inputs = { ...base, scan: { context: "failed" as const, kpi: "pending" as const }, monitorsTotal: 2, monitorsEnabled: 2, monitorsChecked: 1, errored: 1, connectionErrors: 1 };
    expect(serviceStage(inputs)).toEqual(overviewStage({ ...inputs, realSources: 1, connectionPending: false }));
  });
});
