/**
 * One monitor, one query result → value + condition verdict. PURE (no io). The three places that
 * evaluate a monitor — the scheduled runner, "test now" (actions.ts::testAlert) and the recovery
 * check (recovery-actions.ts) — all go through here, so a goal monitor can never be evaluated one
 * way on the cron and another way on the button.
 *
 * Shared with the Trigger.dev runtime — no `import 'server-only'`.
 */
import type { AlertErrorCode } from './error-codes'
import {
  anomalyDecision,
  ANOMALY_SERIES_MAX,
  conditionMet,
  scalarFromRows,
  seriesFromRows,
  type AlertOp,
} from './evaluate'
import { dropInProgress, evaluateCondition, seriesPointsFromRows, type ConditionEval, type MonitorCondition } from './condition'

export interface EvaluableMonitor {
  type: string
  operator: AlertOp
  threshold: number
  sensitivity: number | null
  /** parsed `alerts.condition`; null/absent = legacy evaluation */
  condition?: MonitorCondition | null
}

export interface QueryResultLike {
  columns: string[]
  rows: Array<Record<string, unknown>>
  truncated?: boolean
}

export type MonitorEvalDetail =
  | { kind: 'threshold' }
  | { kind: 'legacy_anomaly'; mean: number; stddev: number; z: number }
  | { kind: 'goal'; condition: MonitorCondition; result: ConditionEval; bucket: string | null; droppedInProgress: number }

export type MonitorEvalOutcome =
  | { ok: true; value: number; met: boolean; detail: MonitorEvalDetail }
  | { ok: false; code: AlertErrorCode }

/** A series monitor (goal or legacy anomaly) reads many rows; a threshold monitor one scalar. */
export function isSeriesMonitor(m: Pick<EvaluableMonitor, 'type' | 'condition'>): boolean {
  return Boolean(m.condition) || m.type === 'anomaly'
}

export function monitorMaxRows(m: Pick<EvaluableMonitor, 'type' | 'condition'>): number {
  return isSeriesMonitor(m) ? ANOMALY_SERIES_MAX : 1
}

export function evaluateMonitorResult(
  m: EvaluableMonitor,
  res: QueryResultLike,
  nowMs: number,
  timezone: string,
): MonitorEvalOutcome {
  // A truncated series drops the NEWEST points (executeReadOnly keeps the first maxRows), so the
  // "latest" would be weeks old — refuse instead of evaluating stale data.
  if (isSeriesMonitor(m) && res.truncated) return { ok: false, code: 'series_too_long' }

  if (m.condition) {
    const all = seriesPointsFromRows(res.columns, res.rows)
    const { points, dropped } = dropInProgress(all, nowMs, timezone)
    if (points.length === 0) return { ok: false, code: 'series_too_short' }
    const values = points.map((p) => p.value)
    const result = evaluateCondition(values, m.condition)
    const last = points[points.length - 1]
    return {
      ok: true,
      value: last.value,
      met: result.met,
      detail: { kind: 'goal', condition: m.condition, result, bucket: last.bucket, droppedInProgress: dropped },
    }
  }

  if (m.type === 'anomaly') {
    const series = seriesFromRows(res.columns, res.rows)
    if (series.length === 0) return { ok: false, code: 'series_too_short' }
    const a = anomalyDecision(series, m.sensitivity ?? 3)
    return { ok: true, value: a.latest, met: a.isAnomaly, detail: { kind: 'legacy_anomaly', mean: a.mean, stddev: a.stddev, z: a.z } }
  }

  const value = scalarFromRows(res.columns, res.rows)
  if (value === null) return { ok: false, code: 'no_scalar' }
  return { ok: true, value, met: conditionMet(value, m.operator, m.threshold), detail: { kind: 'threshold' } }
}
