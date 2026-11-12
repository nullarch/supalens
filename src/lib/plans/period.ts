// Pure date helper for billing windows (no io — unit-tested in period.test.ts).

/**
 * Add calendar months with end-of-month CLAMPING (UTC). `setMonth(+1)` overflows short months
 * (Jan 31 → Mar 3, May 31 → Jul 1), drifting the billing window end by 1–3 days and skipping
 * short months entirely. Clamp instead: Jan 31 → Feb 28/29, May 31 → Jun 30.
 */
export function addMonthsClamped(from: Date, months: number): Date {
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth()
  const day = from.getUTCDate()
  // day 0 of month m+n+1 = last day of month m+n
  const lastDayOfTarget = new Date(Date.UTC(y, m + months + 1, 0)).getUTCDate()
  return new Date(
    Date.UTC(
      y,
      m + months,
      Math.min(day, lastDayOfTarget),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  )
}
