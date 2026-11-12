/**
 * Overview stage — PURE decision logic for what the app home renders (no io).
 *
 * The home splits on "is Supalens WATCHING something", not on the seven-step activation
 * checklist: an org with one enabled monitor is operating even without a repo, Slack or
 * three approved KPIs, and switching monitors off never sends an operating org back to a
 * setup checklist. The activation steps (`logic.ts`) remain the funnel / lifecycle-email
 * signal and the "improve your setup" suggestions.
 *
 * Order of precedence (first match wins):
 *   new          no real source            (connection pending → sub-variant)
 *   analyzing    a real source, nothing enabled, the scan (context / KPI) is running
 *   proposals    nothing enabled, KPI proposals await review
 *   extract      nothing enabled, no proposals, nothing running (maybe a failed run)
 *   paused       monitors exist on real sources, none enabled
 *   first_check  enabled monitors, none evaluated yet
 *   operating    at least one enabled monitor has been evaluated
 * `recovery` is an override flag shown above any stage: a broken connection or scan.
 */

export type OverviewStage =
  | "new"
  | "analyzing"
  | "proposals"
  | "extract"
  | "paused"
  | "first_check"
  | "operating";

/** Operating sub-state, for the banner tone. Mirrors the board priority. */
export type BoardState = "firing" | "degraded" | "pending" | "normal";

export type ScanPhase = "pending" | "running" | "done" | "failed" | "skipped";

export type OverviewStageInputs = {
  /** Active, non-demo, non-deleted data sources. */
  realSources: number;
  /** A Supabase account is authorized but no project has become a source yet. */
  connectionPending: boolean;
  /** Scan phases of the first real source (null when unknown / no source). */
  scan: { context: ScanPhase; kpi: ScanPhase } | null;
  /** KPI proposals with status 'proposed' on real sources. */
  pendingProposals: number;
  /** Monitors on real sources (enabled or not). */
  monitorsTotal: number;
  /** Enabled monitors on real sources. */
  monitorsEnabled: number;
  /** Enabled monitors that have been evaluated at least once. */
  monitorsChecked: number;
  firing: number;
  errored: number;
  /** Enabled monitors whose last error is a broken connection (re-authorize). */
  connectionErrors: number;
};

export type OverviewStageResult = {
  stage: OverviewStage;
  board: BoardState;
  /** Something the user must repair, shown above the stage. */
  recovery: "reconnect" | "scan_failed" | null;
};

export function boardState(i: Pick<OverviewStageInputs, "firing" | "errored" | "monitorsEnabled" | "monitorsChecked">): BoardState {
  if (i.firing > 0) return "firing";
  if (i.errored > 0) return "degraded";
  if (i.monitorsEnabled > i.monitorsChecked) return "pending";
  return "normal";
}

export function overviewStage(i: OverviewStageInputs): OverviewStageResult {
  const scanRunning = !!i.scan && (i.scan.context === "running" || i.scan.kpi === "running");
  const scanFailed = !!i.scan && (i.scan.context === "failed" || i.scan.kpi === "failed");

  let stage: OverviewStage;
  if (i.realSources === 0) stage = "new";
  else if (i.monitorsEnabled > 0) stage = i.monitorsChecked > 0 ? "operating" : "first_check";
  else if (i.monitorsTotal > 0) stage = "paused";
  else if (scanRunning) stage = "analyzing";
  else if (i.pendingProposals > 0) stage = "proposals";
  else stage = "extract";

  const recovery =
    i.connectionErrors > 0 ? "reconnect"
      // A failed scan only blocks the user while nothing is being watched yet.
      : scanFailed && !scanRunning && i.monitorsEnabled === 0 && i.realSources > 0 ? "scan_failed"
        : null;

  return { stage, board: boardState(i), recovery };
}

/** A stage a real data source can be in — `new` is org-level (nothing connected). */
export type ServiceStage = Exclude<OverviewStage, "new">;

export type ServiceStageResult = Omit<OverviewStageResult, "stage"> & { stage: ServiceStage };

/**
 * The stage of ONE real data source, for the per-service overview. Same precedence as
 * `overviewStage`, with every input scoped to that source.
 */
export function serviceStage(i: Omit<OverviewStageInputs, "realSources" | "connectionPending">): ServiceStageResult {
  const { stage, board, recovery } = overviewStage({ ...i, realSources: 1, connectionPending: false });
  // Unreachable: a real source is never `new`. Kept as a guard rather than a cast.
  if (stage === "new") throw new Error("serviceStage: a real source cannot be 'new'");
  return { stage, board, recovery };
}
