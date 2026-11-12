/**
 * How a monitor's rule READS — one wording for every screen (monitor list/detail, incidents,
 * the approval card). PURE: the caller passes the `appCondition` translator and its number
 * formatter, so this works in client components and server pages alike.
 */
import type { ConditionView } from './condition'
import { expectedRangeLabel } from './evaluate'

type T = (key: string, values?: Record<string, string | number>) => string

function pctLabel(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`
}

function sigmaLabel(k: number): string {
  return String(Math.round(k * 10) / 10)
}

/** The full rule as a sentence: "Alert when it falls well below its usual range (3σ)". */
export function conditionSentence(view: ConditionView, t: T, fmt: (n: number) => string): string {
  switch (view.kind) {
    case 'anomaly':
      return t(`sentence.anomaly_${view.direction}`, { sigma: sigmaLabel(view.sensitivity) })
    case 'relative':
      return view.window === 1
        ? t(`sentence.relative_${view.direction}_prev`, { pct: pctLabel(view.pct) })
        : t(`sentence.relative_${view.direction}`, { pct: pctLabel(view.pct), n: view.window })
    case 'absolute':
      return t(`sentence.absolute_${view.operator}`, { value: fmt(view.threshold) })
  }
}

/** What the usual range is learned from — null for rules without a baseline. */
export function conditionBasis(view: ConditionView, t: T): string | null {
  if (view.kind !== 'anomaly') return null
  return view.window === null ? t('basisWholeSeries') : t('basisWindow', { n: view.window })
}

/**
 * The compact cell form. A fixed line keeps the existing "expected range" reading (inverted firing
 * operator, "≥ 4,000"); a learned rule states its sensitivity instead.
 */
export function conditionShort(view: ConditionView, t: T, fmt: (n: number) => string): string {
  switch (view.kind) {
    case 'anomaly':
      return t(`short.anomaly_${view.direction}`, { sigma: sigmaLabel(view.sensitivity) })
    case 'relative':
      return view.window === 1
        ? t(`short.relative_${view.direction}_prev`, { pct: pctLabel(view.pct) })
        : t(`short.relative_${view.direction}`, { pct: pctLabel(view.pct), n: view.window })
    case 'absolute':
      return expectedRangeLabel(view.operator, fmt(view.threshold))
  }
}
