import { describe, expect, it } from "vitest";

import {
  CRON_PERIOD_SECONDS,
  expectedOperator,
  expectedRangeLabel,
  OPERATOR_SYMBOL,
  effectiveCheckInterval,
  isDue,
  conditionMet,
  decideTransition,
  scalarFromRows,
  seriesFromRows,
  anomalyDecision,
  MIN_ANOMALY_BASELINE,
  type AlertEvalState,
  type AlertEvalConfig,
} from "./evaluate";

describe("conditionMet", () => {
  it("compares with every operator", () => {
    expect(conditionMet(5, "lt", 10)).toBe(true);
    expect(conditionMet(10, "lt", 10)).toBe(false);
    expect(conditionMet(10, "lte", 10)).toBe(true);
    expect(conditionMet(11, "gt", 10)).toBe(true);
    expect(conditionMet(10, "gte", 10)).toBe(true);
    expect(conditionMet(10, "eq", 10)).toBe(true);
    expect(conditionMet(9, "neq", 10)).toBe(true);
  });
});

const cfg = (over: Partial<AlertEvalConfig> = {}): AlertEvalConfig => ({
  operator: "lt",
  threshold: 10,
  fireThreshold: 1,
  cooldownSeconds: 3600,
  ...over,
});
const state = (over: Partial<AlertEvalState> = {}): AlertEvalState => ({
  status: "normal",
  consecutiveFires: 0,
  lastNotifiedAt: null,
  ...over,
});
const T0 = new Date("2026-07-01T00:00:00Z").getTime();

describe("decideTransition", () => {
  it("fires on the normal→firing edge and notifies (fireThreshold=1)", () => {
    const t = decideTransition(true, state(), cfg(), T0);
    expect(t).toEqual({
      status: "firing",
      consecutiveFires: 1,
      edge: "fired",
      notify: true,
    });
  });

  it("requires N consecutive hits when fireThreshold>1 (hysteresis)", () => {
    const c = cfg({ fireThreshold: 3 });
    const t1 = decideTransition(true, state({ consecutiveFires: 0 }), c, T0);
    expect(t1).toMatchObject({
      status: "normal",
      consecutiveFires: 1,
      edge: null,
    });
    const t2 = decideTransition(true, state({ consecutiveFires: 1 }), c, T0);
    expect(t2).toMatchObject({
      status: "normal",
      consecutiveFires: 2,
      edge: null,
    });
    const t3 = decideTransition(true, state({ consecutiveFires: 2 }), c, T0);
    expect(t3).toMatchObject({
      status: "firing",
      consecutiveFires: 3,
      edge: "fired",
      notify: true,
    });
  });

  it("does NOT re-fire while already firing (no duplicate edge)", () => {
    const t = decideTransition(
      true,
      state({ status: "firing", consecutiveFires: 5 }),
      cfg(),
      T0,
    );
    expect(t).toEqual({
      status: "firing",
      consecutiveFires: 6,
      edge: null,
      notify: false,
    });
  });

  it("resolves on the firing→normal edge and notifies", () => {
    const t = decideTransition(
      false,
      state({ status: "firing", consecutiveFires: 4 }),
      cfg(),
      T0,
    );
    expect(t).toEqual({
      status: "normal",
      consecutiveFires: 0,
      edge: "resolved",
      notify: true,
    });
  });

  it("stays normal with no edge when condition never met", () => {
    const t = decideTransition(false, state(), cfg(), T0);
    expect(t).toEqual({
      status: "normal",
      consecutiveFires: 0,
      edge: null,
      notify: false,
    });
  });

  it("suppresses notification inside the cooldown window but still records the edge", () => {
    const justNotified = new Date(T0 - 60_000).toISOString(); // 1 min ago
    const t = decideTransition(
      true,
      state({ lastNotifiedAt: justNotified }),
      cfg({ cooldownSeconds: 3600 }),
      T0,
    );
    expect(t.edge).toBe("fired");
    expect(t.notify).toBe(false); // within 1h cooldown
  });

  it("allows notification once cooldown has elapsed", () => {
    const longAgo = new Date(T0 - 2 * 3600_000).toISOString(); // 2h ago
    const t = decideTransition(
      true,
      state({ lastNotifiedAt: longAgo }),
      cfg({ cooldownSeconds: 3600 }),
      T0,
    );
    expect(t.notify).toBe(true);
  });
});

describe("scalarFromRows", () => {
  it("reads the first cell of the first row as a number", () => {
    expect(scalarFromRows(["total"], [{ total: 42 }])).toBe(42);
    expect(scalarFromRows(["total"], [{ total: "1500000" }])).toBe(1500000);
  });
  it("returns null for empty / null / non-numeric", () => {
    expect(scalarFromRows(["total"], [])).toBeNull();
    expect(scalarFromRows([], [{ total: 1 }])).toBeNull();
    expect(scalarFromRows(["total"], [{ total: null }])).toBeNull();
    expect(scalarFromRows(["total"], [{ total: "abc" }])).toBeNull();
  });
});

describe("seriesFromRows", () => {
  it("reads the LAST column across rows in order, skipping non-numeric", () => {
    expect(
      seriesFromRows(
        ["day", "v"],
        [
          { day: "a", v: 1 },
          { day: "b", v: "2" },
          { day: "c", v: 3 },
        ],
      ),
    ).toEqual([1, 2, 3]);
    expect(seriesFromRows(["v"], [{ v: 5 }, { v: null }, { v: 7 }])).toEqual([
      5, 7,
    ]);
    expect(seriesFromRows([], [{ v: 1 }])).toEqual([]);
  });
});

describe("anomalyDecision", () => {
  const flat = Array.from({ length: 12 }, () => 100); // stable baseline

  it("does not flag until there is enough history", () => {
    expect(anomalyDecision([1, 2, 3], 3).isAnomaly).toBe(false);
    expect(
      anomalyDecision(
        Array.from({ length: MIN_ANOMALY_BASELINE }, () => 100),
        3,
      ).isAnomaly,
    ).toBe(false);
  });
  it("fires when the latest point is a strong outlier", () => {
    const r = anomalyDecision([...flat, 500], 3);
    expect(r.isAnomaly).toBe(true);
    expect(r.latest).toBe(500);
  });
  it("does not fire when the latest point is in the normal range", () => {
    const noisy = [100, 102, 98, 101, 99, 103, 97, 100, 101, 99];
    expect(anomalyDecision([...noisy, 100], 3).isAnomaly).toBe(false);
  });
  it("handles a zero-spread baseline", () => {
    expect(anomalyDecision([...flat, 100], 3).isAnomaly).toBe(false); // latest === mean → z 0
    expect(anomalyDecision([...flat, 101], 3).z).toBe(Infinity); // no spread but latest differs
    expect(anomalyDecision([...flat, 101], 3).isAnomaly).toBe(true);
  });
  it("respects the sensitivity cutoff", () => {
    const withJump = [100, 90, 110, 95, 105, 92, 108, 100, 96, 104, 130];
    expect(anomalyDecision(withJump, 1.5).isAnomaly).toBe(true); // sensitive
    expect(anomalyDecision(withJump, 5).isAnomaly).toBe(false); // lenient
  });
});

describe("plan cadence (isDue / effectiveCheckInterval)", () => {
  const now = Date.parse("2026-09-04T10:00:00Z");
  const ago = (sec: number) => new Date(now - sec * 1000).toISOString();
  it("never-checked alerts are always due", () => {
    expect(isDue(null, 7200, now)).toBe(true);
    expect(isDue(undefined, 7200, now)).toBe(true);
    expect(isDue("not-a-date", 7200, now)).toBe(true);
  });
  it("honours the plan interval with cron-jitter tolerance", () => {
    expect(isDue(ago(300), 600, now)).toBe(false); // basic 10m: checked 5m ago → not yet
    expect(isDue(ago(599), 600, now)).toBe(true); // a tick 1s early still counts
    expect(isDue(ago(7000), 7200, now)).toBe(false); // free 2h
    expect(isDue(ago(7200), 7200, now)).toBe(true);
    expect(isDue(ago(300), 300, now)).toBe(true); // standard 5m: every tick
  });
  it("the effective interval never goes below the cron period (premium 1m → 5m today)", () => {
    expect(effectiveCheckInterval(60)).toBe(CRON_PERIOD_SECONDS);
    expect(effectiveCheckInterval(600)).toBe(600);
    expect(effectiveCheckInterval(0)).toBe(CRON_PERIOD_SECONDS);
    expect(effectiveCheckInterval(Number.NaN)).toBe(CRON_PERIOD_SECONDS);
  });
});

describe('operator display', () => {
  it('inverts the firing operator into the expected one', () => {
    // "fires when value < 4M" means the monitor expects value >= 4M — never the other way round.
    expect(expectedOperator('lt')).toBe('gte')
    expect(expectedOperator('lte')).toBe('gt')
    expect(expectedOperator('gt')).toBe('lte')
    expect(expectedOperator('gte')).toBe('lt')
    expect(expectedOperator('eq')).toBe('neq')
    expect(expectedOperator('neq')).toBe('eq')
  })
  it('is its own inverse', () => {
    for (const op of ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const) {
      expect(expectedOperator(expectedOperator(op))).toBe(op)
    }
  })
  it('labels the healthy range, not the firing condition', () => {
    expect(expectedRangeLabel('lt', '₩4.0M')).toBe('≥ ₩4.0M')
    expect(expectedRangeLabel('gt', '5%')).toBe('≤ 5%')
  })
  it('has a symbol for every operator', () => {
    for (const op of ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const) {
      expect(OPERATOR_SYMBOL[op]).toBeTruthy()
    }
  })
})
