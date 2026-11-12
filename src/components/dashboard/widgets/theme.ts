/**
 * Chart theming — categorical series + axis/grid/tick constants, expressed as the
 * global CSS-variable strings (defined in globals.css :root + the [data-theme=dark]
 * block) so Recharts SVG reads them at paint time, stays consistent with the rest
 * of supalens, and inverts cleanly under a dark theme without touching components.
 * Series colors are independent from semantic status and neutral actions.
 */
import type { ChartSpec } from '@/lib/viz/spec'

export const CHART_PALETTE = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const

export const PRIMARY = 'var(--series-1)'
export const PRIMARY_DEEP = 'var(--clay-deep)'

// Recessive scaffolding (the app chart spec): faint grid, a quiet baseline,
// small muted ticks in the interface sans. App-only tokens carry global fallbacks
// because widgets also render on /demo, /share and the landing page.
export const GRID_STROKE = 'var(--ax-line-soft, var(--line))'
export const AXIS_STROKE = 'var(--line)'
export const REF_STROKE = 'var(--ink-3)'
/** hover band behind a bar category / guide line for line + area charts */
export const CURSOR_FILL = 'var(--ax-fill-soft, var(--paper-3))'
export const CURSOR_STROKE = 'var(--line-2)'

/** tick label style passed to Recharts XAxis/YAxis `tick`. */
export const TICK = { fill: 'var(--ink-3)', fontFamily: 'var(--font-sans)', fontSize: 11 } as const

export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 12 } as const

/** Thin marks: bars cap their width, round only the free end (4px), lines stay 2px. */
export const BAR_MAX_SIZE = 32
export const BAR_RADIUS = 4
export const LINE_WIDTH = 2

/** intent → solid color (positive/negative/target lines). Shared by chart
 *  reference lines AND KPI deltas so one color always means one thing. */
export const INTENT_COLOR: Record<string, string> = {
  positive: 'var(--intent-positive)',
  negative: 'var(--intent-negative)',
  target: 'var(--intent-target)',
  warning: 'var(--intent-warning)',
  critical: 'var(--intent-critical)',
  neutral: 'var(--intent-neutral)',
}

export const seriesColor = (i: number): string => CHART_PALETTE[i % CHART_PALETTE.length]

// NOTE: every <Legend> passes `itemSorter={null}` — Recharts 3 defaults to itemSorter="value",
// which re-sorts legend items away from the series (stack) order the marks render in.

export const ANIM_MS = 420

// ── sizing: ONE source of truth (used by the renderer's body reserve, the
//    chart frame, and the loading skeleton, so there is no CLS or dead space) ──
export const CHART_HEIGHT = { base: 240, multi: 280, slice: 208 } as const

/** Reserved plot height for a spec. Cartesian multi-series get more vertical room
 *  for the legend; pie/donut are squarer. Horizontal bars size by row count in
 *  BarWidget itself (this is the non-horizontal default). */
export function chartHeight(spec: ChartSpec): number {
  if (spec.type === 'pie' || spec.type === 'donut') return CHART_HEIGHT.slice
  const multi =
    ('series' in spec && !!spec.series) ||
    ('y' in spec && Array.isArray((spec as { y?: unknown }).y) && ((spec as { y: unknown[] }).y).length > 1)
  return multi ? CHART_HEIGHT.multi : CHART_HEIGHT.base
}

/** Roughly size a Y axis to its longest formatted tick (about 7px/character),
 *  so compact-currency ticks ("US$5360만") and long ko category labels aren't clipped. */
export function axisWidthFor(labels: string[], min = 48, max = 120): number {
  const longest = labels.reduce((n, l) => Math.max(n, l ? l.length : 0), 0)
  return Math.min(max, Math.max(min, Math.round(longest * 7 + 16)))
}
