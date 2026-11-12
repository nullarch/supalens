// Minimal five-field cron matcher (minute hour day-of-month month day-of-week), evaluated in UTC
// like the schedules it replaces. Supports `*`, `*/n`, `a`, `a-b`, `a-b/n` and comma lists —
// everything the task schedules in ./trigger use. Pure; no timers here.

const RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday; 7 is accepted as Sunday)
]

function fieldMatches(field: string, value: number, [min, max]: readonly [number, number]): boolean {
  return field.split(',').some((part) => {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) return false
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      lo = a
      hi = b
    } else {
      lo = Number(range)
      hi = stepRaw === undefined ? lo : max
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false
    return value >= lo && value <= hi && (value - lo) % step === 0
  })
}

/** Is this cron expression well-formed (as far as this matcher understands it)? */
export function isValidCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/)
  return fields.length === 5 && fields.every((f) => /^[\d*,/-]+$/.test(f))
}

/** Does `expression` fire in the minute containing `at` (UTC)? */
export function cronMatches(expression: string, at: Date): boolean {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const dow = at.getUTCDay()
  const values = [at.getUTCMinutes(), at.getUTCHours(), at.getUTCDate(), at.getUTCMonth() + 1, dow]
  return fields.every((field, i) =>
    i === 4
      ? fieldMatches(field, dow, RANGES[4]) || (dow === 0 && fieldMatches(field, 7, [0, 7]))
      : fieldMatches(field, values[i], RANGES[i]),
  )
}

/** The start of the minute containing `at`, as a stable key (so a tick never fires a job twice). */
export function minuteKey(at: Date): number {
  return Math.floor(at.getTime() / 60_000)
}
