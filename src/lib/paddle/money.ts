// NOT `import 'server-only'` — pure formatting helpers (shared paddle-module convention),
// usable from server pages and client components alike.

/**
 * Currencies whose Paddle minor unit IS the major unit (zero-decimal): Paddle sends
 * `grand_total` in the currency's smallest unit, which for these is the whole won/yen/dong —
 * dividing by 100 would display ₩29,000 as "290.00".
 */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND'])

/** Convert a Paddle minor-unit amount (e.g. transaction `grand_total`) to major units. */
export function minorToMajor(amountMinor: number, currency: string | null | undefined): number {
  const code = (currency ?? 'USD').toUpperCase()
  return ZERO_DECIMAL.has(code) ? amountMinor : amountMinor / 100
}

/** Locale + currency-aware display for a Paddle minor-unit amount ("₩29,000", "$29.00"). */
export function formatMoney(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
  locale = 'en-US',
): string {
  if (amountMinor == null || !Number.isFinite(amountMinor)) return '—'
  const code = (currency ?? 'USD').toUpperCase()
  const major = minorToMajor(amountMinor, code)
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(major)
  } catch {
    // unknown/garbage currency code from an upstream record — degrade, don't crash the page
    return `${major.toLocaleString(locale)} ${code}`
  }
}
