/**
 * Pure alert-evaluation decision logic — NO db / io / env, so it unit-tests
 * exhaustively and the Trigger.dev runner can stay a thin shell around it.
 *
 * An alert is TYPE-AGNOSTIC at evaluation time: `metric_sql` produced one scalar,
 * and we compare it to `threshold` with `operator`. Whether it's a "threshold" or
 * "change_rate" alert is a UI label — both are the same scalar comparison here.
 *
 * Firing is edge-triggered with hysteresis + cooldown so a value hovering around
 * the threshold does not spam: we only NOTIFY on the normal→firing edge (after
 * `fireThreshold` consecutive true evaluations) and again on firing→normal, each
 * gated by `cooldownSeconds` since the last notification.
 */

export type AlertOp = "lt" | "lte" | "gt" | "gte" | "eq" | "neq";
export type AlertStatus = "normal" | "firing";

/** Does the observed scalar satisfy the alert's condition right now? */
export function conditionMet(
  value: number,
  operator: AlertOp,
  threshold: number,
): boolean {
  switch (operator) {
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "eq":
      return value === threshold;
    case "neq":
      return value !== threshold;
  }
}

/** The mutable evaluation state persisted on the alert row. */
export interface AlertEvalState {
  status: AlertStatus;
  consecutiveFires: number;
  lastNotifiedAt: string | null; // ISO timestamp
}

/** Static knobs that shape the transition. */
export interface AlertEvalConfig {
  operator: AlertOp;
  threshold: number;
  fireThreshold: number; // N consecutive `true` evaluations required to fire
  cooldownSeconds: number;
}

export interface AlertTransition {
  /** Next persisted status. */
  status: AlertStatus;
  /** Next consecutive-true counter. */
  consecutiveFires: number;
  /** Whether this evaluation is a firing/resolve EDGE (drives event insert). */
  edge: "fired" | "resolved" | null;
  /** Whether to actually send a notification now (edge AND past cooldown). */
  notify: boolean;
}

/**
 * Decide the next state from the current one + this tick's observation.
 *
 * @param met      condition satisfied this tick (`conditionMet(...)`)
 * @param state    current persisted state
 * @param cfg      alert knobs
 * @param nowMs    evaluation time (ms since epoch) — injected so tests are deterministic
 */
export function decideTransition(
  met: boolean,
  state: AlertEvalState,
  cfg: AlertEvalConfig,
  nowMs: number,
): AlertTransition {
  const cooldownOk =
    state.lastNotifiedAt === null ||
    nowMs - new Date(state.lastNotifiedAt).getTime() >=
      cfg.cooldownSeconds * 1000;

  if (met) {
    const consecutiveFires = state.consecutiveFires + 1;
    // Fire only when we cross the hysteresis count AND we're currently normal.
    const crossing =
      state.status === "normal" &&
      consecutiveFires >= Math.max(1, cfg.fireThreshold);
    if (crossing) {
      return {
        status: "firing",
        consecutiveFires,
        edge: "fired",
        notify: cooldownOk,
      };
    }
    // already firing, or not enough consecutive hits yet → stay put, no edge
    return {
      status: state.status,
      consecutiveFires,
      edge: null,
      notify: false,
    };
  }

  // condition NOT met → reset the counter; resolve if we were firing
  if (state.status === "firing") {
    return {
      status: "normal",
      consecutiveFires: 0,
      edge: "resolved",
      notify: cooldownOk,
    };
  }
  return { status: "normal", consecutiveFires: 0, edge: null, notify: false };
}

/**
 * Coerce a query result's first cell to a finite number. Returns null when the
 * query returned no rows / a non-numeric / null value, so the runner can record
 * an eval error instead of firing on garbage.
 */
export function scalarFromRows(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): number | null {
  if (rows.length === 0 || columns.length === 0) return null;
  const raw = rows[0][columns[0]];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract a numeric SERIES from a query result for anomaly alerts. The metric_sql is expected to
 * return rows ordered oldest→newest with the measure as the LAST column (e.g.
 * `select day, sum(amount) v from ... group by day order by day`). Non-numeric rows are skipped.
 * Returns the values in row order — the LAST element is the current observation.
 */
export function seriesFromRows(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): number[] {
  if (columns.length === 0) return [];
  const valueCol = columns[columns.length - 1];
  const out: number[] = [];
  for (const row of rows) {
    const raw = row[valueCol];
    if (raw === null || raw === undefined) continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export interface AnomalyResult {
  /** Is the latest point an outlier vs the trailing baseline? */
  isAnomaly: boolean;
  /** Latest observation (the value the alert "fired on"). */
  latest: number;
  mean: number;
  stddev: number;
  /** |latest - mean| / stddev (0 when there's no spread and latest === mean; Infinity when spread
   *  is 0 but latest differs). */
  z: number;
  /** Number of baseline points used. */
  n: number;
}

/** Need enough history before a baseline is meaningful; below this, never flag an anomaly. */
export const MIN_ANOMALY_BASELINE = 8;

/**
 * Max points pulled for an anomaly series. The series is ordered oldest→newest and the LAST point
 * is the current observation, but executeReadOnly keeps the FIRST maxRows — so a series longer than
 * this would drop the newest points and evaluate a stale value as "latest". Callers must therefore
 * treat a truncated series as an error, not evaluate it. Bounded to cap per-row-billed scans yet
 * high enough for common cadences (hourly over ~83 days, daily over 5 years).
 */
export const ANOMALY_SERIES_MAX = 2000;

/**
 * Threshold-LESS anomaly decision: z-score of the LATEST point vs the trailing baseline (all prior
 * points). Fires when z >= sensitivity (default 3). Deterministic + pure (no LLM) — consistent with
 * the runner's "no LLM at eval time" design. Returns isAnomaly=false until there's enough history.
 * (EWMA / seasonal decomposition is a future refinement.)
 */
export function anomalyDecision(
  series: number[],
  sensitivity: number,
): AnomalyResult {
  const k = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 3;
  if (series.length < MIN_ANOMALY_BASELINE + 1) {
    const latest = series.length ? series[series.length - 1] : 0;
    return {
      isAnomaly: false,
      latest,
      mean: latest,
      stddev: 0,
      z: 0,
      n: Math.max(0, series.length - 1),
    };
  }
  const latest = series[series.length - 1];
  const baseline = series.slice(0, -1);
  const n = baseline.length;
  const mean = baseline.reduce((a, b) => a + b, 0) / n;
  const variance =
    baseline.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const stddev = Math.sqrt(variance);
  const z =
    stddev === 0
      ? latest === mean
        ? 0
        : Infinity
      : Math.abs(latest - mean) / stddev;
  return { isAnomaly: z >= k, latest, mean, stddev, z, n };
}

/**
 * Plan cadence — PURE. The cron ticks every CRON_PERIOD_SECONDS for everyone; each plan
 * defines a minimum interval between checks of one alert (`alert_min_check_interval`).
 * An alert is due when it has never been checked or when at least `intervalSec` has
 * elapsed since `lastCheckedAt`, minus a tolerance so cron jitter (a tick landing a few
 * seconds early) can't push a 10-minute alert out to the 15-minute tick.
 */
export const CRON_PERIOD_SECONDS = 300;
export const DUE_TOLERANCE_SECONDS = 60;

/** The interval the scheduler can actually honour: never finer than the cron period. */
export function effectiveCheckInterval(
  planIntervalSec: number,
  cronPeriodSec = CRON_PERIOD_SECONDS,
): number {
  if (!Number.isFinite(planIntervalSec) || planIntervalSec <= 0)
    return cronPeriodSec;
  return Math.max(planIntervalSec, cronPeriodSec);
}

export function isDue(
  lastCheckedAt: string | null | undefined,
  intervalSec: number,
  nowMs: number,
  toleranceSec = DUE_TOLERANCE_SECONDS,
): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (Number.isNaN(last)) return true;
  const elapsedSec = (nowMs - last) / 1000;
  return elapsedSec >= intervalSec - toleranceSec;
}

/**
 * Operator display — PURE.
 *
 * `alerts.operator` describes the FIRING condition ("fire when value < 4,000,000"), so a UI that
 * wants to state the EXPECTED range must invert it ("expected ≥ 4,000,000"). Rendering the stored
 * operator as-is reads exactly backwards, which is why this lives here next to `conditionMet`
 * rather than being re-derived in each screen.
 */
export const OPERATOR_SYMBOL: Record<AlertOp, string> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  eq: "=",
  neq: "≠",
};

const INVERSE: Record<AlertOp, AlertOp> = {
  lt: "gte",
  lte: "gt",
  gt: "lte",
  gte: "lt",
  eq: "neq",
  neq: "eq",
};

/** The operator of the condition that holds while the monitor is HEALTHY. */
export function expectedOperator(fireOn: AlertOp): AlertOp {
  return INVERSE[fireOn];
}

/** e.g. fireOn `lt` + "₩4.0M" → "≥ ₩4.0M" — the range the monitor expects to stay inside. */
export function expectedRangeLabel(
  fireOn: AlertOp,
  formattedThreshold: string,
): string {
  return `${OPERATOR_SYMBOL[expectedOperator(fireOn)]} ${formattedThreshold}`;
}
