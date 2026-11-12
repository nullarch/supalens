/**
 * Row reshaping shared by the cartesian charts (bar / line / area). Recharts wants
 * an array of objects with numeric series fields; our query rows are
 * Record<string, unknown> keyed by column name (pg often returns numerics as
 * strings), and the agent may emit either WIDE (y: string[]) or LONG (series: col)
 * format. This normalizes both into { rows, seriesKeys } ready for Recharts.
 */
import { othersLabel } from '@/lib/viz/format'
import type { SpecOf } from '../types'

type Row = Record<string, unknown>
type Cartesian = SpecOf<'bar' | 'stackedBar' | 'groupedBar' | 'line' | 'multiLine' | 'area'>

export function coerceNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Pivot long format → wide. [{x, s, v}] → [{x, [s1]:v, [s2]:v}], preserving order. */
function pivotLongToWide(
  rows: Row[],
  xKey: string,
  seriesKey: string,
  valueKey: string
): { rows: Row[]; seriesKeys: string[] } {
  const byX = new Map<string, Row>()
  const order: string[] = []
  const seriesSeen = new Set<string>()
  const seriesKeys: string[] = []

  for (const r of rows) {
    const xv = String(r[xKey])
    const sv = String(r[seriesKey])
    if (!seriesSeen.has(sv)) {
      seriesSeen.add(sv)
      seriesKeys.push(sv)
    }
    if (!byX.has(xv)) {
      byX.set(xv, { [xKey]: r[xKey] })
      order.push(xv)
    }
    byX.get(xv)![sv] = coerceNum(r[valueKey])
  }
  return { rows: order.map((x) => byX.get(x)!), seriesKeys }
}

/** sort an array of rows by column `by` (numeric when possible, else locale string). */
function sortRows(rows: Row[], by: string, dir: 'asc' | 'desc', fallback?: (r: Row) => number): Row[] {
  return [...rows].sort((a, b) => {
    const av = by in a ? coerceNum(a[by]) : fallback ? fallback(a) : null
    const bv = by in b ? coerceNum(b[by]) : fallback ? fallback(b) : null
    if (av != null && bv != null) return dir === 'asc' ? av - bv : bv - av
    return dir === 'asc'
      ? String(a[by]).localeCompare(String(b[by]))
      : String(b[by]).localeCompare(String(a[by]))
  })
}

export function resolveCartesian(spec: Cartesian, rows: Row[]): { rows: Row[]; xKey: string; seriesKeys: string[] } {
  const xKey = spec.x

  // LONG format → pivot to wide FIRST, then sort/limit on whole x-categories.
  // (Slicing raw long tuples before the pivot would drop entire categories — e.g.
  //  limit:6 on a 6mo×3series=18-row set kept only 2 months.)
  if (spec.series) {
    const valueKey = Array.isArray(spec.y) ? spec.y[0] : spec.y
    const { rows: pivoted, seriesKeys } = pivotLongToWide(rows, xKey, spec.series, valueKey)
    let wide = pivoted
    if (spec.sort) {
      // sort by the named column if it survived the pivot, else by the row's series total
      const total = (r: Row) => seriesKeys.reduce((s, k) => s + (coerceNum(r[k]) ?? 0), 0)
      wide = sortRows(wide, spec.sort.by, spec.sort.dir, total)
    }
    if (spec.limit && wide.length > spec.limit) wide = wide.slice(0, spec.limit)
    return { rows: wide, xKey, seriesKeys }
  }

  // WIDE format (single or multi value columns): sort + limit on the rows directly.
  let work = rows
  if (spec.sort) work = sortRows(rows, spec.sort.by, spec.sort.dir)
  if (spec.limit && work.length > spec.limit) work = work.slice(0, spec.limit)

  const seriesKeys = Array.isArray(spec.y) ? spec.y : [spec.y]
  const coerced = work.map((r) => {
    const o: Row = { ...r }
    for (const k of seriesKeys) o[k] = coerceNum(r[k])
    return o
  })
  return { rows: coerced, xKey, seriesKeys }
}

/** Estimate the value-axis label width using the largest magnitude, preserving
 *  its sign. Separate stacked positive/negative extents so cancellation cannot
 *  disguise a wide label. This does not change plotted values or domains. */
export function maxSeriesValue(rows: Row[], seriesKeys: string[], stacked = false): number {
  let extent = 0
  const include = (value: number) => {
    if (Math.abs(value) > Math.abs(extent) || (Math.abs(value) === Math.abs(extent) && value < extent)) extent = value
  }
  for (const r of rows) {
    let positive = 0
    let negative = 0
    for (const k of seriesKeys) {
      const n = coerceNum(r[k])
      if (n != null) {
        if (n < 0) negative += n
        else positive += n
        if (!stacked) include(n)
      }
    }
    if (stacked) { include(positive); include(negative) }
  }
  return extent
}

/** [{category, value}] for pie/donut — coerces value, applies limit. */
export function resolveSlices(
  rows: Row[],
  categoryKey: string,
  valueKey: string,
  limit?: number
): { name: string; value: number }[] {
  const slices = rows
    .map((r) => ({ name: String(r[categoryKey] ?? '—'), value: coerceNum(r[valueKey]) ?? 0 }))
    .sort((a, b) => b.value - a.value)
  if (limit && slices.length > limit) {
    const head = slices.slice(0, limit - 1)
    const restTotal = slices.slice(limit - 1).reduce((sum, s) => sum + s.value, 0)
    return [...head, { name: othersLabel(), value: restTotal }]
  }
  return slices
}
