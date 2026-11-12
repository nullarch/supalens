/**
 * Percent-format sanity check shared by the propose_visualization tools (SQL + Firestore
 * agents) and the propose_kpi validation core.
 *
 * Convention: format kind 'percent' multiplies by 100 and expects FRACTIONS (0.013 → "1.3%")
 * — see formatValue() in ./format.ts. Agent-authored SQL, however, usually bakes the ×100 in
 * (`round(100.0 * …)`), so a percent-formatted column holding percentage points renders
 * double-scaled (1.27 → "127%"). This check catches the mismatch empirically: any referenced
 * value above PERCENT_FRACTION_MAX cannot plausibly be a fraction.
 *
 * Pure (no React/server/DB imports) so it stays unit-testable and adds no capability to the
 * locked-down agents — same contract as spec.ts.
 */
import type { ChartSpec, Format } from './spec'

/** Fractions ≤ 1 are legit (plus rounding slop); anything above reads as percentage points. */
const PERCENT_FRACTION_MAX = 1.05

interface Target {
  format: Format | undefined
  cols: string[]
}

/** (format, referenced columns) pairs that formatValue() will render, per chart type. */
function percentTargets(chart: ChartSpec): Target[] {
  switch (chart.type) {
    case 'kpi':
      return [{ format: chart.format, cols: [chart.value, ...(chart.comparison ? [chart.comparison.value] : [])] }]
    case 'bignumber':
      return [{ format: chart.format, cols: [chart.value] }]
    case 'pie':
    case 'donut':
      return [{ format: chart.valueFormat, cols: [chart.value] }]
    case 'scatter':
      return [
        { format: chart.xFormat, cols: [chart.x] },
        { format: chart.yFormat, cols: [chart.y] },
      ]
    case 'table':
      return chart.columns.map((c) => ({ format: c.format, cols: [c.key] }))
    default:
      // cartesian family (bar / stackedBar / groupedBar / line / multiLine / area)
      return [
        { format: chart.xFormat, cols: [chart.x] },
        { format: chart.yFormat, cols: Array.isArray(chart.y) ? chart.y : [chart.y] },
      ]
  }
}

function maxAbs(rows: Record<string, unknown>[], col: string): number {
  let max = NaN
  for (const row of rows) {
    const n = Math.abs(Number(row?.[col]))
    if (Number.isFinite(n) && (!Number.isFinite(max) || n > max)) max = n
  }
  return max
}

/**
 * Returns a self-repair error message when a percent-formatted column's values are too large
 * to be fractions (the double-×100 bug), or null when the chart is fine. `rows` is the query
 * result the chart references (the stashed execute_sql / query_documents result).
 */
export function percentSanityIssue(chart: ChartSpec, rows: Record<string, unknown>[]): string | null {
  for (const target of percentTargets(chart)) {
    if (target.format?.kind !== 'percent') continue
    for (const col of target.cols) {
      const max = maxAbs(rows, col)
      if (Number.isFinite(max) && max > PERCENT_FRACTION_MAX) {
        return (
          `Format kind "percent" multiplies by 100 and expects FRACTIONS (0.013 → "1.3%"), ` +
          `but column "${col}" holds values up to ${max} — these look like percentage points already ` +
          `(they would render as "${Math.round(max * 100)}%"). Either rewrite the query to return fractions, ` +
          `or keep the values and use format {kind: "number", unit: "%"} instead.`
        )
      }
    }
  }
  return null
}
