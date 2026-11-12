/**
 * Pure validation core for the in-process `propose_kpi` MCP tool (design: docs/auto-kpi-plan.md).
 *
 * No MCP / agent / DB imports — it reads only the in-process result map the SQL tools stash by
 * queryId, so it is fully unit-testable and adds NO capability to the locked-down agent. Mirrors
 * the propose_visualization validation core in src/lib/viz/propose.ts: every error explains how the
 * model can self-repair (unknown queryId → run execute_sql; a non-scalar alert → return one
 * scalar; a bad column → the valid column list), so a rejected proposal is coached back into shape.
 */
import { z } from 'zod'

import { VisualizationSpec, referencedColumns } from '@/lib/viz/spec'
import { percentSanityIssue } from '@/lib/viz/percent-sanity'
import { seriesFromRows } from '@/lib/alerts/evaluate'
import { NO_MONITOR_REASONS, ProposeKpiInput, type KpiProposal } from './types'

/** A prior successful execute_sql result, stashed by the SQL tools under its queryId. */
export interface StashedQuery {
  sql: string
  columns: string[]
  rows: Record<string, unknown>[]
}

/** Parsed args the tool hands the validator (= z.infer of z.object(ProposeKpiInput)). */
export type ProposeKpiArgs = z.infer<ReturnType<typeof z.object<typeof ProposeKpiInput>>>

/** true when the result is a single numeric scalar: 1 row × 1 column, Number(value) finite. */
function isScalarNumeric(q: StashedQuery): boolean {
  if (q.columns.length !== 1 || q.rows.length !== 1) return false
  const v = q.rows[0][q.columns[0]]
  if (v === null || v === undefined) return false
  return Number.isFinite(Number(v))
}

/**
 * Validate a KPI proposal against the stashed result its queryId references. Returns the
 * SQL-bound proposal on success, or a self-repair error string. Does NOT mutate `seenKeys` —
 * the caller records the key only after the sink has accepted the proposal.
 */
export function validateKpiProposal(
  store: Pick<Map<string, StashedQuery>, 'get'>,
  seenKeys: Set<string>,
  input: ProposeKpiArgs,
): { ok: true; proposal: KpiProposal } | { ok: false; error: string } {
  const q = store.get(input.queryId)
  if (!q) {
    return {
      ok: false,
      error: `Unknown queryId "${input.queryId}". Run execute_sql first and use the queryId it returns.`,
    }
  }

  if (seenKeys.has(input.key)) {
    return {
      ok: false,
      error: `KPI key "${input.key}" is already proposed in this run. Pick a different key, or skip it if it duplicates a KPI you already proposed.`,
    }
  }

  // A KPI must declare how it will be watched: either an alert, or WHY it can't be. Without this
  // "Monitor all" silently produced dashboard-only widgets with no explanation anywhere.
  if (!input.alert && !input.noMonitorReason) {
    return {
      ok: false,
      error: `KPI "${input.key}" declares no monitor. Every KPI must either carry an "alert" (threshold for a scalar, anomaly for a time series) or state why it cannot be watched via "noMonitorReason": one of ${NO_MONITOR_REASONS.join(' | ')}. Prefer an anomaly alert whenever the metric can be re-expressed as a daily series.`,
    }
  }
  if (input.alert && input.noMonitorReason) {
    return {
      ok: false,
      error: `KPI "${input.key}" passed both "alert" and "noMonitorReason". Send exactly one: the alert if it can be monitored, the reason if it cannot.`,
    }
  }

  if (input.alert) {
    if (input.alert.type === 'anomaly') {
      // Anomaly alerts are threshold-LESS: the runner takes the z-score of the LATEST point vs its
      // trailing baseline, so the query must return a numeric time SERIES (multiple rows), NOT a
      // scalar. seriesFromRows reads the last column oldest→newest, exactly as the runner does.
      // (A scalar anomaly alert was silently accepted before and could never fire — see propose.test.)
      const series = seriesFromRows(q.columns, q.rows)
      if (series.length < 2) {
        return {
          ok: false,
          error: `An anomaly alert monitors a time SERIES, so its query must return multiple rows ordered oldest→newest with the numeric measure as the LAST column (e.g. \`select day, sum(amount) as v from ... group by day order by day\`). This result yields ${series.length} usable numeric point(s). Return a series, or drop "alert".`,
        }
      }
    } else if (!isScalarNumeric(q)) {
      // threshold alerts compare ONE scalar against a fixed line.
      const scalarShape = q.columns.length === 1 && q.rows.length === 1
      return {
        ok: false,
        error: scalarShape
          ? `A threshold alert needs a single numeric value, but this result's value ${JSON.stringify(q.rows[0][q.columns[0]])} is not a finite number. Return a numeric scalar, or drop "alert".`
          : `A threshold alert needs a single numeric value (one scalar compared to a fixed line), but this result is ${q.rows.length} row(s) × ${q.columns.length} column(s). Return exactly one scalar metric, use type "anomaly" for a series, or drop "alert".`,
      }
    }
  }

  const missing = referencedColumns(input.chart).filter((c) => !q.columns.includes(c))
  if (missing.length) {
    return {
      ok: false,
      error: `Columns ${JSON.stringify(missing)} referenced by the chart are not in this result. Valid columns: ${JSON.stringify(q.columns)}.`,
    }
  }

  const parsed = VisualizationSpec.safeParse({
    v: 1,
    query: { sql: q.sql },
    // 50-row cap (propose_visualization keeps 200): catalog rows persist to the DB, keep them small.
    sample: { columns: q.columns, rows: q.rows.slice(0, 50) },
    chart: input.chart,
  })
  if (!parsed.success) {
    return { ok: false, error: `Invalid visualization spec: ${JSON.stringify(parsed.error.flatten())}` }
  }

  // percent double-scale guard: a percent-formatted column whose values exceed 1 was authored
  // against SQL that already multiplied by 100 — it would render 1.27 as "127%".
  const pctIssue = percentSanityIssue(parsed.data.chart, q.rows)
  if (pctIssue) {
    return { ok: false, error: pctIssue }
  }

  const proposal: KpiProposal = {
    key: input.key,
    title: input.title,
    category: input.category,
    description: input.description,
    importance: input.importance,
    metricSql: q.sql,
    vizSpec: parsed.data,
    alertConfig: input.alert,
    noMonitor: input.noMonitorReason
      ? { kind: 'none', reason: input.noMonitorReason, ...(input.noMonitorNote ? { note: input.noMonitorNote } : {}) }
      : undefined,
    evidence: input.evidence,
  }
  return { ok: true, proposal }
}
