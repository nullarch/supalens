/**
 * Shape check for a goal monitor's metric — PURE. Shared by the drafting agent's `propose_monitor`
 * validator and MCP `create_alert`, so a goal monitor can only be created over a series the runner
 * will actually evaluate correctly. Every error is written for the author (model or human) to
 * self-repair.
 *
 * v1 goal monitors are DAILY: one row per calendar day, oldest → newest, the bucket first and the
 * measure last. Two rules are stricter than "any series":
 *   - no missing days. `GROUP BY day` silently omits a day with zero activity, so a drop to ZERO —
 *     the most important thing a "tell me when signups stop" monitor must catch — could never fire.
 *     The day axis has to come from generate_series.
 *   - the series must reach the most recent complete day, or the monitor would evaluate a stale
 *     point forever.
 *
 * Shared with the Trigger.dev runtime — no `import 'server-only'`.
 */
import {
  backtestCondition,
  dateInZone,
  dropInProgress,
  evaluateCondition,
  seriesPointsFromRows,
  type BacktestResult,
  type ConditionEval,
  type MonitorCondition,
  type SeriesPoint,
} from './condition'
import { MIN_ANOMALY_BASELINE } from './evaluate'

/** The day-axis SQL shape every error below points at. */
export const DAILY_SERIES_EXAMPLE =
  "with days as (select generate_series(current_date - 90, current_date - 1, interval '1 day')::date as day) " +
  'select d.day, count(t.id) as value from days d left join <table> t on t.created_at >= d.day and t.created_at < d.day + 1 ' +
  'group by d.day order by d.day'

/** Longest series a goal monitor may return (the runner reads at most ANOMALY_SERIES_MAX rows). */
export const GOAL_SERIES_MAX_POINTS = 1000

const DAY_MS = 86_400_000

/** Complete history points a strategy needs before it can evaluate the latest one. */
export function minHistoryFor(cond: MonitorCondition): number {
  if (cond.strategy === 'anomaly') return MIN_ANOMALY_BASELINE
  if (cond.strategy === 'relative') return cond.window
  return 0
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
}

export interface GoalSeriesCheck {
  /** complete daily points (the in-progress day removed) */
  points: SeriesPoint[]
  droppedInProgress: number
  /** the condition evaluated at the latest complete day — what the monitor would say right now */
  current: ConditionEval
  /** the condition replayed over the returned history */
  backtest: BacktestResult
}

export function checkGoalSeries(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  cond: MonitorCondition,
  nowMs: number,
  timezone: string,
): { ok: true; check: GoalSeriesCheck } | { ok: false; error: string } {
  if (columns.length < 2) {
    return {
      ok: false,
      error: `A goal monitor watches a DAILY series: return the day first and the numeric measure last (got ${columns.length} column). Example: ${DAILY_SERIES_EXAMPLE}`,
    }
  }
  if (rows.length >= GOAL_SERIES_MAX_POINTS) {
    return { ok: false, error: `The series has ${rows.length}+ rows — limit it to the last 90–180 days.` }
  }
  const all = seriesPointsFromRows(columns, rows)
  if (all.length !== rows.length) {
    return { ok: false, error: `Every row needs a numeric value in the LAST column ("${columns[columns.length - 1]}"); use coalesce(…, 0) for empty days.` }
  }
  if (all.some((p) => p.bucket === null)) {
    return { ok: false, error: `The FIRST column ("${columns[0]}") must be a date (one row per day). Example: ${DAILY_SERIES_EXAMPLE}` }
  }
  for (let i = 1; i < all.length; i++) {
    const gap = dayNumber(all[i].bucket as string) - dayNumber(all[i - 1].bucket as string)
    if (gap <= 0) {
      return { ok: false, error: `Rows must be one per day, ordered oldest → newest (order by the day ascending); "${all[i].bucket}" follows "${all[i - 1].bucket}".` }
    }
    if (gap > 1) {
      return {
        ok: false,
        error: `Days are missing between ${all[i - 1].bucket} and ${all[i].bucket}. A day with no activity must appear as 0 — otherwise a drop to zero can never fire. Build the day axis with generate_series and LEFT JOIN: ${DAILY_SERIES_EXAMPLE}`,
      }
    }
  }

  const { points, dropped } = dropInProgress(all, nowMs, timezone)
  const need = minHistoryFor(cond) + 1
  if (points.length < need) {
    return {
      ok: false,
      error: `This rule needs at least ${need} complete days of history; the series has ${points.length}. Widen the window (e.g. the last 90 days).`,
    }
  }
  const last = points[points.length - 1].bucket as string
  const cutoff = dateInZone(nowMs, 'UTC') < dateInZone(nowMs, timezone) ? dateInZone(nowMs, 'UTC') : dateInZone(nowMs, timezone)
  if (dayNumber(cutoff) - dayNumber(last) > 2) {
    return {
      ok: false,
      error: `The series ends on ${last}, but the monitor must watch the most recent complete day. End the day axis at current_date - 1 (or later).`,
    }
  }

  const values = points.map((p) => p.value)
  return {
    ok: true,
    check: {
      points,
      droppedInProgress: dropped,
      current: evaluateCondition(values, cond),
      backtest: backtestCondition(values, cond),
    },
  }
}
