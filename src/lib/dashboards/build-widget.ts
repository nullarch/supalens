/**
 * Shared widget-spec builder: run one widget's SQL through the read-only engine and validate its
 * chart into a persistable VisualizationSpec. Extracted verbatim from src/lib/mcp/tools.ts so the
 * MCP tools (create_dashboard / add_widget) AND the Auto-KPI one-shot apply (src/lib/kpi/apply.ts)
 * share ONE validation path: assertReadOnly -> executeReadOnly dry-run -> column check -> safeParse.
 *
 * NOT `import 'server-only'` — the read-only query engine it builds on (src/lib/query/*) carries no
 * 'server-only' guard because it is runtime-shared, so neither does this. Both callers today are
 * Vercel-only, but keeping the import hygiene identical to src/lib/query/* avoids a future
 * Trigger-side import throwing at load time.
 */
import type { z } from 'zod'

import { assertReadOnly, executeReadOnly } from '@/lib/query'
import type { Actor } from '@/lib/secrets/service'
import { ChartSpec, VisualizationSpec, referencedColumns } from '@/lib/viz/spec'

/**
 * Default grid span for a freshly-added widget, by chart type (shared by the web action, the
 * Auto-KPI apply, and MCP add_widget). DashboardGrid renders ROW=64px rows with 14px gaps, and
 * the card head is ~57px:
 *  - kpi/bignumber tiles hold ~132px of content → h:3; the old blanket h:4 left ~64% dead space.
 *  - multi-series cartesian charts reserve 280px + a legend row → h:5 (h:4 overflowed the card).
 *  - everything else fits the 240px base reserve → h:4.
 */
export function defaultGridSize(chart: z.infer<typeof ChartSpec>): { w: number; h: number } {
  if (chart.type === 'kpi' || chart.type === 'bignumber') return { w: 6, h: 3 }
  const multi =
    ('series' in chart && !!chart.series) ||
    ('y' in chart && Array.isArray(chart.y) && chart.y.length > 1)
  return { w: 6, h: multi ? 5 : 4 }
}

/** Run + validate one widget's SQL into a persistable VisualizationSpec. Throws on any problem. */
export async function buildWidgetSpec(
  dataSourceId: string,
  actor: Actor,
  sql: string,
  chart: z.infer<typeof ChartSpec>
): Promise<{ spec: z.infer<typeof VisualizationSpec>; sample: { columns: string[]; rows: Record<string, unknown>[] } }> {
  assertReadOnly(sql)
  const r = await executeReadOnly(dataSourceId, sql, { actor, maxRows: 500, timeoutMs: 30_000 })
  const missing = referencedColumns(chart).filter((c) => !r.columns.includes(c))
  if (missing.length)
    throw new Error(
      `chart references columns ${JSON.stringify(missing)} not in the result. Valid columns: ${JSON.stringify(r.columns)}`
    )
  const sample = { columns: r.columns, rows: r.rows.slice(0, 200) }
  const parsed = VisualizationSpec.safeParse({ v: 1, query: { sql }, sample, chart })
  if (!parsed.success) throw new Error(`invalid visualization spec: ${JSON.stringify(parsed.error.flatten())}`)
  return { spec: parsed.data, sample }
}
