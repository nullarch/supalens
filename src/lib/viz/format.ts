/**
 * Value formatting for widgets. Pure (no React) so it is shared by the chart
 * components, the table, KPI tiles, axis ticks, and tooltips.
 *
 * Locale: `setVizLocale` is called by WidgetRenderer (from next-intl's useLocale) before its
 * subtree renders, so numbers/dates follow the app locale on both server and client render.
 * Fallbacks: <html lang> on the client (set by the root layout), then English. Never hardcode
 * ko-KR here — that was the pre-i18n convention and is now a regression.
 */
import type { Format } from './spec'

const INTL_LOCALE: Record<string, string> = { ko: 'ko-KR', ja: 'ja-JP', en: 'en-US' }

let vizLocale: string | null = null

/** Set by WidgetRenderer per render pass (module singleton — formatValue is called deep inside
 *  chart internals where threading a locale prop through every call site isn't practical). */
export function setVizLocale(locale: string | null | undefined): void {
  vizLocale = locale ?? null
}

function appLocale(): string {
  if (vizLocale) return vizLocale
  if (typeof document !== 'undefined' && document.documentElement.lang) return document.documentElement.lang
  return 'en'
}

function intlLocale(): string {
  const l = appLocale()
  return INTL_LOCALE[l] ?? l
}

/** Overflow-slice label for top-N capped pie/donut charts, in the app locale. */
export function othersLabel(): string {
  const l = appLocale()
  return l === 'ko' ? '기타' : l === 'ja' ? 'その他' : 'Other'
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function fmtNumber(n: number, f?: Format): string {
  const opts: Intl.NumberFormatOptions = { notation: f?.compact ? 'compact' : 'standard' }
  if (f?.decimals != null) {
    opts.minimumFractionDigits = f.decimals
    opts.maximumFractionDigits = f.decimals
  } else {
    opts.maximumFractionDigits = f?.compact ? 1 : 2
  }
  return new Intl.NumberFormat(intlLocale(), opts).format(n)
}

/** Format one cell/axis value according to its Format spec. Never throws. */
export function formatValue(value: unknown, f?: Format): string {
  if (value == null) return '—'
  const kind = f?.kind ?? 'number'

  if (kind === 'string') return String(value)

  if (kind === 'date') {
    const d = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(d.getTime())) return String(value)
    const g = f?.dateGranularity ?? 'day'
    const opts: Intl.DateTimeFormatOptions =
      g === 'year'
        ? { year: 'numeric' }
        : g === 'quarter' || g === 'month'
          ? { year: 'numeric', month: 'short' }
          : g === 'datetime'
            ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { year: 'numeric', month: 'short', day: 'numeric' }
    return new Intl.DateTimeFormat(intlLocale(), opts).format(d)
  }

  const n = toNumber(value)
  if (n == null) return String(value)

  switch (kind) {
    case 'currency': {
      const currency = f?.currency ?? 'KRW'
      const opts: Intl.NumberFormatOptions = {
        style: 'currency',
        currency,
        notation: f?.compact ? 'compact' : 'standard',
        // Compact first: in compact notation fraction digits apply to the compacted
        // mantissa (억/M), not to minor units — KRW's "no minor unit" rule must not
        // zero them out (₩141.2M was rendering as "₩1억" instead of "₩1.4억").
        // Standard notation: KRW has no minor unit; default others to 2.
        maximumFractionDigits: f?.decimals ?? (f?.compact ? 1 : currency === 'KRW' ? 0 : 2),
      }
      return new Intl.NumberFormat(intlLocale(), opts).format(n)
    }
    case 'percent': {
      const opts: Intl.NumberFormatOptions = {
        style: 'percent',
        maximumFractionDigits: f?.decimals ?? 1,
      }
      // convention: values are already fractions (0.146 → 14.6%)
      return new Intl.NumberFormat(intlLocale(), opts).format(n)
    }
    case 'duration':
      return `${fmtNumber(n, f)}${f?.unit ?? 'ms'}`
    case 'compact': {
      // same unit-suffix rule as the default number branch — compact must not silently drop it
      const s = fmtNumber(n, { ...f, kind: 'number', compact: true })
      return f?.unit ? `${s}${f.unit}` : s
    }
    default: {
      const s = fmtNumber(n, f)
      return f?.unit ? `${s}${f.unit}` : s
    }
  }
}

/**
 * Axis-TICK variant of formatValue: identical except day/datetime dates drop the year
 * ("2026년 6월 23일" → "6. 23."). A full localized date repeated on every tick drowns a small
 * plot (ko/ja are the longest), and the year belongs to the tooltip — which keeps formatValue.
 * Month/quarter/year granularities keep the year: there it IS the signal.
 */
export function formatTick(value: unknown, f?: Format): string {
  if (f?.kind === 'date' && value != null) {
    const d = value instanceof Date ? value : new Date(String(value))
    if (!Number.isNaN(d.getTime())) {
      const g = f.dateGranularity ?? 'day'
      if (g === 'day')
        return new Intl.DateTimeFormat(intlLocale(), { month: 'numeric', day: 'numeric' }).format(d)
      if (g === 'datetime')
        return new Intl.DateTimeFormat(intlLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
    }
  }
  return formatValue(value, f)
}

/** Signed delta + percent change between a current and prior value, for KPI tiles. */
export function computeDelta(
  current: unknown,
  prior: unknown
): { deltaPct: number | null; deltaAbs: number | null; direction: 'up' | 'down' | 'flat' } {
  const c = toNumber(current)
  const p = toNumber(prior)
  if (c == null || p == null) return { deltaPct: null, deltaAbs: null, direction: 'flat' }
  const deltaAbs = c - p
  const deltaPct = p === 0 ? null : deltaAbs / Math.abs(p)
  const direction = deltaAbs > 0 ? 'up' : deltaAbs < 0 ? 'down' : 'flat'
  return { deltaPct, deltaAbs, direction }
}
