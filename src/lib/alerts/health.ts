// Pure, client-safe monitor health helpers — no io, no `server-only`, so both the /app/monitors
// client components and the server pages can share ONE definition of "healthy / incident /
// error / paused" and of "when is the next check".
//
// Cadence is PER PLAN (`alert_min_check_interval` in plans/limits.ts, enforced by alerts/runner.ts
// via evaluate.ts::isDue) and floored to the 5-minute cron period by evaluate.ts::effectiveCheckInterval
// — the server page resolves the org's interval once and threads it into every helper here.

export type MonitorHealth = 'healthy' | 'incident' | 'error' | 'paused'

export interface HealthInput {
  enabled: boolean
  status: string
  lastError: string | null
}

/** Paused wins over everything (a disabled monitor is not evaluated), then a live incident, then an
 *  evaluation error (query failed on the last tick), else healthy. */
export function healthOf(a: HealthInput): MonitorHealth {
  if (!a.enabled) return 'paused'
  if (a.status === 'firing') return 'incident'
  if (a.lastError) return 'error'
  return 'healthy'
}

/**
 * When the runner will look at this monitor next, given the org's effective check interval (seconds).
 * `null` when paused. A never-checked monitor is picked up on the next cron tick, so "now + interval"
 * is the honest upper bound; an overdue one (cron lag) is clamped to now so the UI never shows a past time.
 */
export function nextCheckAt(
  a: { enabled: boolean; lastCheckedAt: string | null },
  intervalSec: number,
  now: number = Date.now(),
): Date | null {
  if (!a.enabled) return null
  const intervalMs = Math.max(1, intervalSec) * 1000
  const last = a.lastCheckedAt ? Date.parse(a.lastCheckedAt) : NaN
  if (!Number.isFinite(last)) return new Date(now + intervalMs)
  return new Date(Math.max(last + intervalMs, now))
}

/** Split an interval into the unit the UI should say it in: whole hours when ≥ 1h, else minutes. */
export function cadenceParts(intervalSec: number): { unit: 'hours' | 'minutes'; n: number } {
  const sec = Math.max(60, intervalSec)
  if (sec >= 3600 && sec % 3600 === 0) return { unit: 'hours', n: sec / 3600 }
  return { unit: 'minutes', n: Math.round(sec / 60) }
}
