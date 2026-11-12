/**
 * supalens visualization spec — the SINGLE SOURCE OF TRUTH for the contract the
 * Claude agent emits to choose + configure a chart. Imported by THREE layers:
 *   1. the agent tool layer (validates before emit, src/lib/agent/tools.ts)
 *   2. the widget renderer  (validates before render, src/components/dashboard/widgets)
 *   3. the persistence layer (validates before write, src/lib/dashboards)
 *
 * It is plain zod + types (NO React, NO server-only imports) so every layer can
 * import it. The agent only ever sees a query result's bare column NAMES, so all
 * encodings reference columns by name (a string).
 */
import { z } from 'zod'

export const SPEC_VERSION = 1 as const

// ──────────────────────────────────────────────────────────────────────────
// shared building blocks
// ──────────────────────────────────────────────────────────────────────────

/** A column name exactly as it appears in a query result's `columns`. */
const ColumnRef = z
  .string()
  .min(1)
  .describe('A column name exactly as returned in the query result `columns`.')

/** One value column, or several for a wide-format multi-series chart. */
const YEncoding = z
  .union([ColumnRef, z.array(ColumnRef).min(1).max(12)])
  .describe('One value column, or an array of value columns for multi-series.')

/** How a numeric / date value is rendered. Consumed by formatValue(). */
export const FormatSchema = z.object({
  kind: z
    .enum(['number', 'currency', 'percent', 'compact', 'duration', 'date', 'string'])
    .default('number')
    .describe(
      `'percent' multiplies by 100 and expects a FRACTION (0.013 → "1.3%"); if the query already returns 0–100 percentage points, use 'number' with unit '%'`
    ),
  currency: z.string().length(3).optional().describe('ISO 4217 (e.g. "KRW", "USD") when kind=currency'),
  decimals: z.number().int().min(0).max(6).optional(),
  compact: z.boolean().optional().describe('abbreviate large numbers (1.2K / 3.4M)'),
  unit: z.string().max(16).optional().describe('suffix label, e.g. "ms", "명"'),
  dateGranularity: z.enum(['day', 'week', 'month', 'quarter', 'year', 'datetime']).optional(),
})
export type Format = z.infer<typeof FormatSchema>

const ColorIntent = z.enum(['default', 'positive', 'negative', 'sequential', 'diverging', 'categorical'])

const ReferenceLine = z.object({
  value: z.number(),
  label: z.string().max(40).optional(),
  intent: z.enum(['target', 'warning', 'critical', 'neutral']).default('neutral'),
})

const Sort = z.object({ by: ColumnRef, dir: z.enum(['asc', 'desc']).default('desc') })

// fields shared by every chart
const meta = {
  title: z.string().max(120),
  description: z.string().max(400).optional(),
}

// fields shared by the cartesian families (bar / line / area)
const cartesian = {
  ...meta,
  x: ColumnRef,
  y: YEncoding,
  series: ColumnRef.optional().describe('split rows into series by this category (long format)'),
  xFormat: FormatSchema.optional(),
  yFormat: FormatSchema.optional(),
  colorIntent: ColorIntent.optional(),
  references: z.array(ReferenceLine).max(4).optional(),
  sort: Sort.optional(),
  limit: z.number().int().positive().max(1000).optional(),
}

// ──────────────────────────────────────────────────────────────────────────
// per-type chart configs (discriminated on `type`)
// ──────────────────────────────────────────────────────────────────────────

export const KpiSpec = z.object({
  ...meta,
  type: z.literal('kpi'),
  value: ColumnRef.describe("column whose FIRST row value is the headline number"),
  format: FormatSchema.optional(),
  comparison: z
    .object({
      value: ColumnRef.describe('column holding the prior / compare value'),
      mode: z.enum(['delta', 'percent']).default('percent'),
      goodDirection: z.enum(['up', 'down']).default('up'),
    })
    .optional(),
  target: z.number().optional(),
})

export const BigNumberSpec = z.object({
  ...meta,
  type: z.literal('bignumber'),
  value: ColumnRef,
  caption: z.string().max(80).optional(),
  format: FormatSchema.optional(),
})

const orientation = z.enum(['vertical', 'horizontal']).default('vertical')
export const BarSpec = z.object({ ...cartesian, type: z.literal('bar'), orientation })
export const StackedBarSpec = z.object({ ...cartesian, type: z.literal('stackedBar'), orientation })
export const GroupedBarSpec = z.object({ ...cartesian, type: z.literal('groupedBar'), orientation })

const curve = z.enum(['linear', 'smooth', 'step']).default('linear')
export const LineSpec = z.object({ ...cartesian, type: z.literal('line'), curve })
export const MultiLineSpec = z.object({ ...cartesian, type: z.literal('multiLine'), curve })
export const AreaSpec = z.object({ ...cartesian, type: z.literal('area'), stacked: z.boolean().default(false) })

export const ScatterSpec = z.object({
  ...meta,
  type: z.literal('scatter'),
  x: ColumnRef,
  y: ColumnRef,
  size: ColumnRef.optional(),
  series: ColumnRef.optional(),
  xFormat: FormatSchema.optional(),
  yFormat: FormatSchema.optional(),
})

const slice = {
  ...meta,
  category: ColumnRef,
  value: ColumnRef,
  valueFormat: FormatSchema.optional(),
  limit: z.number().int().positive().max(50).optional(),
}
export const PieSpec = z.object({ ...slice, type: z.literal('pie') })
export const DonutSpec = z.object({ ...slice, type: z.literal('donut'), centerLabel: z.string().max(40).optional() })

export const TableSpec = z.object({
  ...meta,
  type: z.literal('table'),
  columns: z
    .array(
      z.object({
        key: ColumnRef,
        label: z.string().max(60).optional(),
        format: FormatSchema.optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
      })
    )
    .min(1)
    .max(50),
  sort: Sort.optional(),
  limit: z.number().int().positive().max(1000).optional(),
})

/** The chart config the renderer switches on. (dim1 "ChartConfig" = dim2 "WidgetSpec".) */
export const ChartSpec = z.discriminatedUnion('type', [
  KpiSpec,
  BigNumberSpec,
  BarSpec,
  StackedBarSpec,
  GroupedBarSpec,
  LineSpec,
  MultiLineSpec,
  AreaSpec,
  ScatterSpec,
  PieSpec,
  DonutSpec,
  TableSpec,
])
export type ChartSpec = z.infer<typeof ChartSpec>
export type ChartType = ChartSpec['type']

// ──────────────────────────────────────────────────────────────────────────
// query result data (= execute_sql / QueryResult payload, verbatim — no adapter)
// ──────────────────────────────────────────────────────────────────────────

export const WidgetDataSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  truncated: z.boolean().optional(),
  rowCount: z.number().optional(),
})
export type WidgetData = z.infer<typeof WidgetDataSchema>

/** A bounded row snapshot the agent embeds for instant one-off render. */
const Sample = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())).max(200),
})

/**
 * Structured Firestore re-run descriptor — present ONLY on Firestore-backed widgets so a saved
 * widget can live-refresh without SQL. Mirrors src/lib/firestore FirestoreQuery, but defined
 * INLINE here to keep this module dependency-free (no @google-cloud/firestore import — this file
 * is imported by the client renderer).
 */
export const FirestoreQueryRef = z.object({
  collection: z.string().min(1),
  where: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(['<', '<=', '==', '!=', '>=', '>', 'array-contains', 'in', 'not-in', 'array-contains-any']),
        value: z.unknown(),
      })
    )
    .optional(),
  orderBy: z.object({ field: z.string(), direction: z.enum(['asc', 'desc']).optional() }).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  collectionGroup: z.boolean().optional(),
})
export type FirestoreQueryRef = z.infer<typeof FirestoreQueryRef>

// ──────────────────────────────────────────────────────────────────────────
// the full streamed / persisted contract
// ──────────────────────────────────────────────────────────────────────────

/**
 * Self-contained: the one-off ask answer renders from `sample`; a saved dashboard widget stores
 * this object (minus `sample`) and re-runs its query — `query.sql` for SQL sources, or the
 * structured `query.firestore` descriptor for Firestore sources. Same type. `sql` is always a
 * non-empty string (a human-readable descriptor for Firestore) so the envelope stays uniform.
 */
export const VisualizationSpec = z.object({
  v: z.literal(SPEC_VERSION),
  query: z.object({
    sql: z.string().min(1),
    queryId: z.string().optional(),
    firestore: FirestoreQueryRef.optional(),
  }),
  sample: Sample.optional(),
  chart: ChartSpec,
})
export type VisualizationSpec = z.infer<typeof VisualizationSpec>

/** Model-authored tool input — the server injects v / query / sample. */
export const ProposeVizInput = { queryId: z.string().min(1), chart: ChartSpec }

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

const asArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : v == null ? [] : [v]

/** Every column a chart references — used to validate against a query's columns. */
export function referencedColumns(c: ChartSpec): string[] {
  switch (c.type) {
    case 'kpi':
      return [c.value, ...(c.comparison ? [c.comparison.value] : [])]
    case 'bignumber':
      return [c.value]
    case 'pie':
    case 'donut':
      return [c.category, c.value]
    case 'scatter':
      return [c.x, c.y, ...asArray(c.size), ...asArray(c.series)]
    case 'table':
      return c.columns.map((col) => col.key)
    default:
      // bar / stackedBar / groupedBar / line / multiLine / area
      return [c.x, ...asArray(c.y), ...asArray(c.series)]
  }
}

/** Fallback when the agent proposes no visualization but a query ran. `firestore` carries the
 *  structured re-run descriptor for document-backed results (without it a saved fallback-table
 *  widget from a Firestore run could never live-refresh). `rows` (the query result) is embedded as
 *  the inline `sample` so the fallback table actually RENDERS — a spec with no live-data prop and no
 *  sample parses to empty (WidgetRenderer reads `data ?? sample`), which showed a blank "Results"
 *  table in ask / share / history exactly where this fallback is meant to guarantee output. */
export function buildDefaultTableSpec(
  columns: string[],
  sql: string,
  firestore?: FirestoreQueryRef,
  rows?: Record<string, unknown>[],
): VisualizationSpec {
  const spec: VisualizationSpec = {
    v: SPEC_VERSION,
    query: firestore ? { sql, firestore } : { sql },
    chart: { type: 'table', title: 'Results', columns: columns.map((key) => ({ key })) },
  }
  if (rows && rows.length) spec.sample = { columns, rows: rows.slice(0, 200) }
  return spec
}

/** Persisted dashboard widgets store the envelope WITHOUT its inline sample — the snapshot
 *  lives in the row's `sample` column (single copy, used as a fallback when a live re-run fails). */
export function withoutSample(spec: VisualizationSpec): VisualizationSpec {
  if (!spec.sample) return spec
  const rest = { ...spec }
  delete rest.sample
  return rest
}

/** Upcast a persisted/raw spec to the current version. Returns null if unparseable. */
export function migrateSpec(raw: unknown): VisualizationSpec | null {
  // v1 is current — no upcasts yet. Add `if (raw.v === 0) {...}` branches here later.
  const parsed = VisualizationSpec.safeParse(raw)
  return parsed.success ? parsed.data : null
}
