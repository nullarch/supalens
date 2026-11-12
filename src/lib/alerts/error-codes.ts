/**
 * Stable codes persisted in `alerts.last_error`.
 *
 * That column IS rendered on /app/monitors and /app/incidents, so anything stored there is UI
 * copy. Free-form English (or, worse, hardcoded Korean) sentences written by the runner cannot be
 * translated by the screen and drift the moment someone rewords a `throw`. So every failure the
 * PRODUCT understands persists as one of these codes and the screen renders it through the
 * message catalog.
 *
 * The deliberate exception is a genuine query/driver message (`relation "orders" does not exist`,
 * a syntax error, a statement timeout): that text is the whole diagnostic value for a user
 * debugging their own SQL, so `supabase-oauth/errors.ts::persistableError` passes it through RAW.
 * `isAlertErrorCode` is therefore the renderer's branch: a known code → localized label; anything
 * else → show the message verbatim.
 *
 * PURE and import-free (no io, no React, no server imports) so the runner (Trigger.dev host), the
 * cleanup path, and client components can all share one definition.
 */

/**
 * - `reconnect_required` — the Supabase OAuth grant is gone; re-authorize. (Mirrors
 *   `supabase-oauth/errors.ts::RECONNECT_REQUIRED`, which is where it is produced; pinned equal
 *   in error-codes.test.ts.)
 * - `no_scalar` — a threshold monitor's `metric_sql` returned no numeric scalar.
 * - `series_too_long` — an anomaly monitor's series exceeded ANOMALY_SERIES_MAX and was truncated,
 *   which would drop the NEWEST points; narrow the time window.
 * - `series_too_short` — an anomaly monitor's `metric_sql` returned no numeric series at all.
 * - `source_removed` — the monitor's data source was deleted, so it was disabled.
 */
export const ALERT_ERROR_CODES = [
  'reconnect_required',
  'no_scalar',
  'series_too_long',
  'series_too_short',
  'source_removed',
] as const

export type AlertErrorCode = (typeof ALERT_ERROR_CODES)[number]

export function isAlertErrorCode(value: unknown): value is AlertErrorCode {
  return typeof value === 'string' && (ALERT_ERROR_CODES as readonly string[]).includes(value)
}
