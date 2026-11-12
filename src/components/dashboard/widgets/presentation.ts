import type { ChartSpec, WidgetData } from '@/lib/viz/spec'
import { coerceNum } from './charts/data'

/** A timestamp is a recorded fact, not a live freshness guarantee. */
export function widgetTimestamp(value: string | Date | null | undefined, locale: string) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(date) + ' UTC',
  }
}

/** Do not draw a plausible zero/empty chart when the supplied values cannot be plotted.
 * Partial cartesian gaps remain gaps; no values are interpolated or fabricated. */
export function chartDataIssue(spec: ChartSpec, data: WidgetData): 'needsNumericValues' | 'needsNumericColumns' | 'needsNonNegativeValues' | 'zeroTotal' | null {
  if (spec.type === 'pie' || spec.type === 'donut') {
    const values = data.rows.map(row => coerceNum(row[spec.value]))
    if (values.some(value => value === null || value < 0)) return 'needsNonNegativeValues'
    if (values.every(value => value === 0)) return 'zeroTotal'
  } else if (spec.type === 'scatter') {
    if (!data.rows.some(row => coerceNum(row[spec.x]) !== null && coerceNum(row[spec.y]) !== null)) return 'needsNumericColumns'
  } else if ('y' in spec) {
    const keys = Array.isArray(spec.y) ? spec.y : [spec.y]
    if (!data.rows.some(row => keys.some(key => coerceNum(row[key]) !== null))) return 'needsNumericValues'
  }
  return null
}
