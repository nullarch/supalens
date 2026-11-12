// Pure logic for the MCP App result view: what to draw for a tool result, and the numbers behind
// the drawing. No DOM here, so it is unit-tested (model.test.ts) and the view file only paints.
//
// Types only from the viz spec — the zod schemas must not be bundled into the view.

import type { ChartSpec, Format, VisualizationSpec } from '@/lib/viz/spec'

export type Row = Record<string, unknown>
export interface Table {
  columns: string[]
  rows: Row[]
  truncated?: boolean
  rowCount?: number
}

/** One thing the view draws: a chart config plus the rows it reads. */
export interface Figure {
  chart: ChartSpec
  data: Table
  /** shown under the title when the chart was chosen by the view, not by the analysis agent */
  inferred?: boolean
}

export const MAX_SERIES = 8
const MAX_BAR_CATEGORIES = 30

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function isDateLike(v: unknown): boolean {
  return typeof v === 'string' && ISO_DATE.test(v.trim())
}

function columnKind(rows: Row[], column: string): 'number' | 'date' | 'text' | 'empty' {
  let seen = 0
  let numbers = 0
  let dates = 0
  for (const row of rows) {
    const v = row[column]
    if (v === null || v === undefined || v === '') continue
    seen++
    // a date-like string wins over "parses as a number" ("2026" is a year label, not a quantity)
    if (isDateLike(v)) dates++
    else if (toNumber(v) !== null) numbers++
  }
  if (seen === 0) return 'empty'
  if (dates === seen) return 'date'
  if (numbers === seen) return 'number'
  return 'text'
}

function dateGranularity(rows: Row[], column: string): Format['dateGranularity'] {
  const first = String(rows[0]?.[column] ?? '')
  if (/^\d{4}-\d{2}$/.test(first)) return 'month'
  return /[T ]\d{2}:\d{2}/.test(first) && rows.some((r) => !/[T ]00:00(:00)?/.test(String(r[column]))) ? 'datetime' : 'day'
}

const tableSpec = (title: string, columns: string[]): ChartSpec => ({
  type: 'table',
  title,
  columns: columns.slice(0, 50).map((key) => ({ key })),
})

/**
 * Choose a form for a bare query result (execute_sql and the document tools return rows with no
 * chart config). Deliberately conservative — only the shapes whose reading is unambiguous get a
 * chart; everything else is a table, and the table is always one click away regardless.
 *
 *   one row, one number                      → the number
 *   a date column + numeric columns          → a line over time
 *   a text column + ONE numeric column, ≤30  → horizontal bars (magnitude by category)
 *   anything else                            → a table
 */
export function inferChart(data: Table, title: string): ChartSpec {
  const { columns, rows } = data
  if (columns.length === 0 || rows.length === 0) return tableSpec(title, columns)
  const kinds = columns.map((c) => columnKind(rows, c))
  const numeric = columns.filter((_, i) => kinds[i] === 'number')

  if (rows.length === 1 && columns.length === 1 && numeric.length === 1) {
    return { type: 'bignumber', title, value: columns[0] }
  }
  const [first] = columns
  if (kinds[0] === 'date' && numeric.length >= 1 && numeric.length <= MAX_SERIES && rows.length >= 2) {
    const xFormat: Format = { kind: 'date', dateGranularity: dateGranularity(rows, first) }
    return numeric.length === 1
      ? { type: 'line', title, x: first, y: numeric[0], xFormat, curve: 'linear' }
      : { type: 'multiLine', title, x: first, y: numeric, xFormat, curve: 'linear' }
  }
  if (kinds[0] === 'text' && columns.length === 2 && numeric.length === 1 && rows.length <= MAX_BAR_CATEGORIES) {
    const distinct = new Set(rows.map((r) => String(r[first])))
    if (distinct.size === rows.length) return { type: 'bar', title, x: first, y: numeric[0], orientation: 'horizontal' }
  }
  return tableSpec(title, columns)
}

function isTable(v: unknown): v is Table {
  const t = v as Table | null
  return !!t && typeof t === 'object' && Array.isArray(t.columns) && Array.isArray(t.rows)
}

/**
 * Turn a tool's structuredContent into figures. Two shapes are understood:
 *   - `{columns, rows}` (execute_sql, query_documents, aggregate): one inferred figure;
 *   - `{result: {visualizations: VisualizationSpec[]}}` (get_analysis): the agent's own charts,
 *     each drawn from the sample rows it embedded.
 * Anything else yields no figures and the view says so — it never guesses at unknown payloads.
 */
export function figuresFrom(payload: unknown, fallbackTitle: string): Figure[] {
  if (!payload || typeof payload !== 'object') return []
  if (isTable(payload)) {
    return [{ chart: inferChart(payload, fallbackTitle), data: payload, inferred: true }]
  }
  const result = (payload as { result?: { visualizations?: unknown } }).result
  const specs = Array.isArray(result?.visualizations) ? (result.visualizations as VisualizationSpec[]) : []
  const figures: Figure[] = []
  for (const spec of specs) {
    if (!spec || typeof spec !== 'object' || !spec.chart || !isTable(spec.sample)) continue
    figures.push({ chart: spec.chart, data: spec.sample })
  }
  return figures
}

// ── cartesian series ────────────────────────────────────────────────────────

export interface Series {
  name: string
  /** one value per category; null where the data has none (a gap, not a zero) */
  values: (number | null)[]
}
export interface Cartesian {
  categories: unknown[]
  series: Series[]
  /** series left out because the palette has eight identities; they remain in the table */
  hiddenSeries: number
}

type CartesianSpec = Extract<ChartSpec, { type: 'bar' | 'stackedBar' | 'groupedBar' | 'line' | 'multiLine' | 'area' }>

/** Rows → categories × series, for both the wide form (`y` is a list) and the long form (`series`). */
export function toCartesian(spec: CartesianSpec, rows: Row[]): Cartesian {
  const limited = spec.limit ? rows.slice(0, spec.limit) : rows
  const ys = Array.isArray(spec.y) ? spec.y : [spec.y]
  const categories: unknown[] = []
  const index = new Map<string, number>()
  const at = (value: unknown) => {
    const key = String(value)
    let i = index.get(key)
    if (i === undefined) {
      i = categories.length
      index.set(key, i)
      categories.push(value)
    }
    return i
  }

  const byName = new Map<string, (number | null)[]>()
  const cell = (name: string, i: number, v: unknown) => {
    let values = byName.get(name)
    if (!values) byName.set(name, (values = []))
    const n = toNumber(v)
    // long-form data can repeat a (category, series) pair; the parts add up
    values[i] = n === null ? (values[i] ?? null) : (values[i] ?? 0) + n
  }
  for (const row of limited) {
    const i = at(row[spec.x])
    if (spec.series) cell(String(row[spec.series] ?? '—'), i, row[ys[0]])
    else for (const y of ys) cell(y, i, row[y])
  }

  let series: Series[] = [...byName].map(([name, values]) => ({
    name,
    values: Array.from({ length: categories.length }, (_, i) => values[i] ?? null),
  }))
  let hiddenSeries = 0
  if (series.length > MAX_SERIES) {
    // keep the eight largest by total, in their original order — color follows the entity
    const total = (s: Series) => s.values.reduce<number>((a, v) => a + Math.abs(v ?? 0), 0)
    const keep = new Set([...series].sort((a, b) => total(b) - total(a)).slice(0, MAX_SERIES).map((s) => s.name))
    hiddenSeries = series.length - keep.size
    series = series.filter((s) => keep.has(s.name))
  }
  return { categories, series, hiddenSeries }
}

/** Per-category totals of a stack, split by sign so negatives stack downward. */
export function stackExtent(series: Series[]): { min: number; max: number } {
  const n = series[0]?.values.length ?? 0
  let min = 0
  let max = 0
  for (let i = 0; i < n; i++) {
    let up = 0
    let down = 0
    for (const s of series) {
      const v = s.values[i] ?? 0
      if (v >= 0) up += v
      else down += v
    }
    max = Math.max(max, up)
    min = Math.min(min, down)
  }
  return { min, max }
}

export function valueExtent(series: Series[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const s of series) for (const v of s.values) if (v !== null) { min = Math.min(min, v); max = Math.max(max, v) }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 1 }
}

// ── scales ──────────────────────────────────────────────────────────────────

export interface Scale {
  min: number
  max: number
  ticks: number[]
}

/**
 * A linear scale on clean numbers (1/2/5 × 10ⁿ steps). `zero` anchors the scale at zero — bars
 * and areas encode length, so their axis must include it; a line encodes position and may not.
 */
export function niceScale(lo: number, hi: number, { zero = true, count = 4 }: { zero?: boolean; count?: number } = {}): Scale {
  let min = zero ? Math.min(0, lo) : lo
  let max = zero ? Math.max(0, hi) : hi
  if (min === max) {
    if (min === 0) max = 1
    else { const pad = Math.abs(min) * 0.1; min -= pad; max += pad }
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toPrecision(12)))
  return { min: start, max: end, ticks }
}

/**
 * At most `max` category indexes, at ONE whole step from the first. Uneven spacing (rounding a
 * fractional step, or forcing the last index in) puts two labels side by side, and they collide.
 */
export function pickTicks(count: number, max: number): number[] {
  const step = Math.max(1, Math.ceil(count / Math.max(1, max)))
  const ticks: number[] = []
  for (let i = 0; i < count; i += step) ticks.push(i)
  return ticks
}

// ── slices ──────────────────────────────────────────────────────────────────

export interface Slice {
  label: string
  value: number
  share: number
}

/** Positive slices, largest first; past `max` the tail folds into one "other" slice. */
export function toSlices(rows: Row[], category: string, value: string, other: string, max = 6): Slice[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const n = toNumber(row[value])
    if (n === null || n <= 0) continue
    const key = String(row[category] ?? '—')
    totals.set(key, (totals.get(key) ?? 0) + n)
  }
  const sorted = [...totals].sort((a, b) => b[1] - a[1])
  const head = sorted.slice(0, sorted.length > max ? max - 1 : max)
  const tail = sorted.slice(head.length).reduce((a, [, v]) => a + v, 0)
  const all = tail > 0 ? [...head, [other, tail] as [string, number]] : head
  const sum = all.reduce((a, [, v]) => a + v, 0) || 1
  return all.map(([label, v]) => ({ label, value: v, share: v / sum }))
}
